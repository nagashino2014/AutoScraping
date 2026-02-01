import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

/**
 * 재귀적으로 디렉토리를 탐색하여 파일 찾기
 */
async function findFileRecursively(dir: string, fileName: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // 현재 디렉토리에서 파일 찾기
    for (const entry of entries) {
      if (entry.isFile() && entry.name === fileName) {
        return path.join(dir, entry.name);
      }
    }
    
    // 하위 디렉토리 탐색
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await findFileRecursively(path.join(dir, entry.name), fileName);
        if (found) return found;
      }
    }
  } catch (e) {
    // 디렉토리 접근 실패
  }
  return null;
}

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
  } catch (e) {
    // JSON 파싱 실패
  }
  return null;
}

/**
 * 추출된 텍스트 파일을 읽어오는 API
 * GET /api/processing/extract/text?file_path=...
 * 
 * 백엔드는 JSON 통합 형식으로 저장 (RAG 최적화)
 * - {파일명}.json: 메타데이터 + 본문 텍스트 + 구조화된 표 데이터
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

    // 원본 파일 경로에서 추출된 텍스트 파일 경로 생성
    // 백엔드는 ExtractedData/기관명/보드명/YYYY-MM/파일명.json 구조로 저장
    const baseDir = path.join(process.cwd(), "save", "ExtractedData");
    
    // 원본 파일명에서 확장자를 제거
    const originalFileName = path.basename(filePath);
    const baseName = originalFileName.replace(/\.[^/.]+$/, "");
    
    // JSON 파일 우선 (새 형식), 없으면 md, txt 폴백 (호환성)
    const jsonFileName = baseName + ".json";
    const mdFileName = baseName + ".md";
    const txtFileName = baseName + ".txt";
    
    // 원본 파일 경로에서 기관/보드 정보 추출 시도
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
    
    // 현재 년월
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    // 가능한 경로들을 시도 (.json 우선, .md/.txt 폴백)
    const possiblePaths: string[] = [];
    
    // 1. 기관/보드/날짜 폴더 구조 (백엔드 저장 방식)
    if (orgName && boardName) {
      if (dateFolder) {
        possiblePaths.push(path.join(baseDir, orgName, boardName, dateFolder, jsonFileName));
        possiblePaths.push(path.join(baseDir, orgName, boardName, dateFolder, mdFileName));
        possiblePaths.push(path.join(baseDir, orgName, boardName, dateFolder, txtFileName));
      }
      possiblePaths.push(path.join(baseDir, orgName, boardName, currentYearMonth, jsonFileName));
      possiblePaths.push(path.join(baseDir, orgName, boardName, currentYearMonth, mdFileName));
      possiblePaths.push(path.join(baseDir, orgName, boardName, currentYearMonth, txtFileName));
    }
    
    // 2. 년월 폴더만 (기존 방식)
    possiblePaths.push(path.join(baseDir, currentYearMonth, jsonFileName));
    possiblePaths.push(path.join(baseDir, currentYearMonth, mdFileName));
    possiblePaths.push(path.join(baseDir, currentYearMonth, txtFileName));
    if (dateFolder && dateFolder !== currentYearMonth) {
      possiblePaths.push(path.join(baseDir, dateFolder, jsonFileName));
      possiblePaths.push(path.join(baseDir, dateFolder, mdFileName));
      possiblePaths.push(path.join(baseDir, dateFolder, txtFileName));
    }
    
    // 3. 루트 폴더
    possiblePaths.push(path.join(baseDir, jsonFileName));
    possiblePaths.push(path.join(baseDir, mdFileName));
    possiblePaths.push(path.join(baseDir, txtFileName));

    // 파일 찾기
    let textContent = "";
    let foundPath = "";
    let tables: any[] = [];
    let metadata: any = {};
    let isJsonFormat = false;

    for (const textPath of possiblePaths) {
      try {
        const fileContent = await fs.readFile(textPath, "utf-8");
        
        // JSON 파일인 경우 파싱
        if (textPath.endsWith(".json")) {
          const parsed = extractTextFromJson(fileContent);
          if (parsed) {
            textContent = parsed.text;
            tables = parsed.tables;
            metadata = parsed.metadata;
            foundPath = textPath;
            isJsonFormat = true;
            break;
          }
        } else {
          // .md 또는 .txt 파일
          textContent = fileContent;
          foundPath = textPath;
          break;
        }
      } catch (e) {
        // 파일이 없으면 다음 경로 시도
      }
    }

    if (!textContent) {
      // 4. 재귀적으로 전체 ExtractedData 폴더에서 검색 (.json 우선)
      const foundJson = await findFileRecursively(baseDir, jsonFileName);
      if (foundJson) {
        try {
          const fileContent = await fs.readFile(foundJson, "utf-8");
          const parsed = extractTextFromJson(fileContent);
          if (parsed) {
            textContent = parsed.text;
            tables = parsed.tables;
            metadata = parsed.metadata;
            foundPath = foundJson;
            isJsonFormat = true;
          }
        } catch (e) {
          // 읽기 실패
        }
      }
      
      if (!textContent) {
        const foundMd = await findFileRecursively(baseDir, mdFileName);
        if (foundMd) {
          try {
            textContent = await fs.readFile(foundMd, "utf-8");
            foundPath = foundMd;
          } catch (e) {
            // 읽기 실패
          }
        }
      }
      
      if (!textContent) {
        const foundTxt = await findFileRecursively(baseDir, txtFileName);
        if (foundTxt) {
          try {
            textContent = await fs.readFile(foundTxt, "utf-8");
            foundPath = foundTxt;
          } catch (e) {
            // 읽기 실패
          }
        }
      }
    }

    if (!textContent) {
      return NextResponse.json(
        { 
          ok: false, 
          error: "추출된 텍스트 파일을 찾을 수 없습니다.",
          text: `추출된 텍스트 파일을 찾을 수 없습니다.\n\n검색 경로:\n${possiblePaths.slice(0, 10).join("\n")}\n\n원본 파일: ${filePath}\n\n파일이 저장된 경로와 검색 경로가 다를 수 있습니다. 백엔드 저장 경로를 확인해주세요.`,
          searched_paths: possiblePaths,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      text: textContent,
      file_path: foundPath,
      character_count: textContent.length,
      estimated_tokens: Math.round(textContent.length / 4),
      // 추가 데이터 (JSON 형식인 경우)
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
