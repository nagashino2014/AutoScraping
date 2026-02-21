import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { storage, downloadText } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * JSON 파일에서 텍스트 콘텐츠 추출
 */
function extractTextFromJson(jsonContent: string): { text: string; tables: any[]; metadata: any } | null {
  try {
    const data = JSON.parse(jsonContent);
    if (data.content && data.content.text) {
      return {
        text: data.content.text,
        tables: data.tables || [],
        metadata: data.metadata || {}
      };
    }
  } catch {
    // JSON 파싱 실패
  }
  return null;
}

/**
 * storage에서 키로 텍스트 파일 읽기 시도
 */
async function tryReadFromStorage(key: string): Promise<string | null> {
  try {
    if (await storage.exists(key)) {
      return await downloadText(key);
    }
  } catch {
    // 읽기 실패
  }
  return null;
}

/**
 * storage.list로 파일명 패턴 검색
 */
async function findFileInStorage(prefix: string, fileName: string): Promise<string | null> {
  try {
    const items = await storage.list(prefix);
    for (const item of items) {
      if (!item.Key) continue;
      const basename = item.Key.split("/").pop() || "";
      if (basename === fileName) return item.Key;
    }
  } catch {
    // 목록 조회 실패
  }
  return null;
}

/**
 * 추출된 텍스트 파일을 읽어오는 API
 * GET /api/processing/extract/text?file_path=...
 * 
 * R2 또는 로컬 스토리지에서 읽습니다.
 * ExtractedData/기관명/보드명/YYYY-MM/파일명.json 구조
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("file_path");

    if (!filePath) {
      return NextResponse.json(
        { ok: false, error: "file_path parameter is required" },
        { status: 400 }
      );
    }

    const originalFileName = path.basename(filePath);
    const baseName = originalFileName.replace(/\.[^/.]+$/, "");

    const jsonFileName = baseName + ".json";
    const mdFileName = baseName + ".md";
    const txtFileName = baseName + ".txt";

    const pathParts = filePath.replace(/\\/g, "/").split("/");
    const scrapingIdx = pathParts.findIndex(p => p === "ScrapingData");
    let orgName = "";
    let boardName = "";
    let dateFolder = "";

    if (scrapingIdx !== -1 && pathParts.length > scrapingIdx + 3) {
      orgName = pathParts[scrapingIdx + 1] || "";
      boardName = pathParts[scrapingIdx + 2] || "";
      dateFolder = pathParts[scrapingIdx + 3] || "";
    }

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const candidateKeys: string[] = [];

    if (orgName && boardName) {
      if (dateFolder) {
        candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${dateFolder}/${jsonFileName}`);
        candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${dateFolder}/${mdFileName}`);
        candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${dateFolder}/${txtFileName}`);
      }
      candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${currentYearMonth}/${jsonFileName}`);
      candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${currentYearMonth}/${mdFileName}`);
      candidateKeys.push(`ExtractedData/${orgName}/${boardName}/${currentYearMonth}/${txtFileName}`);
    }

    candidateKeys.push(`ExtractedData/${currentYearMonth}/${jsonFileName}`);
    candidateKeys.push(`ExtractedData/${currentYearMonth}/${mdFileName}`);
    candidateKeys.push(`ExtractedData/${currentYearMonth}/${txtFileName}`);
    if (dateFolder && dateFolder !== currentYearMonth) {
      candidateKeys.push(`ExtractedData/${dateFolder}/${jsonFileName}`);
      candidateKeys.push(`ExtractedData/${dateFolder}/${mdFileName}`);
      candidateKeys.push(`ExtractedData/${dateFolder}/${txtFileName}`);
    }

    candidateKeys.push(`ExtractedData/${jsonFileName}`);
    candidateKeys.push(`ExtractedData/${mdFileName}`);
    candidateKeys.push(`ExtractedData/${txtFileName}`);

    let textContent = "";
    let foundKey = "";
    let tables: any[] = [];
    let metadata: any = {};
    let isJsonFormat = false;

    for (const key of candidateKeys) {
      const content = await tryReadFromStorage(key);
      if (!content) continue;

      if (key.endsWith(".json")) {
        const parsed = extractTextFromJson(content);
        if (parsed) {
          textContent = parsed.text;
          tables = parsed.tables;
          metadata = parsed.metadata;
          foundKey = key;
          isJsonFormat = true;
          break;
        }
      } else {
        textContent = content;
        foundKey = key;
        break;
      }
    }

    if (!textContent) {
      const searchKey = await findFileInStorage("ExtractedData/", jsonFileName);
      if (searchKey) {
        const content = await tryReadFromStorage(searchKey);
        if (content) {
          const parsed = extractTextFromJson(content);
          if (parsed) {
            textContent = parsed.text;
            tables = parsed.tables;
            metadata = parsed.metadata;
            foundKey = searchKey;
            isJsonFormat = true;
          }
        }
      }
    }

    if (!textContent) {
      const searchKeyMd = await findFileInStorage("ExtractedData/", mdFileName);
      if (searchKeyMd) {
        const content = await tryReadFromStorage(searchKeyMd);
        if (content) {
          textContent = content;
          foundKey = searchKeyMd;
        }
      }
    }

    if (!textContent) {
      return NextResponse.json(
        {
          ok: false,
          error: "추출된 텍스트 파일을 찾을 수 없습니다.",
          text: `추출된 텍스트 파일을 찾을 수 없습니다.\n\n검색 키:\n${candidateKeys.slice(0, 10).join("\n")}\n\n원본 파일: ${filePath}\n\n스토리지 백엔드: ${storage.backend}`,
          searched_keys: candidateKeys,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      text: textContent,
      file_path: foundKey,
      character_count: textContent.length,
      estimated_tokens: Math.round(textContent.length / 4),
      is_json_format: isJsonFormat,
      tables: tables,
      metadata: metadata,
    });

  } catch (error: any) {
    console.error("[API] Extract text error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "텍스트 로드 실패" },
      { status: 500 }
    );
  }
}
