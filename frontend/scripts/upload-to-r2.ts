#!/usr/bin/env npx ts-node
/**
 * GitHub Actions 스크래핑 결과를 R2에 업로드
 * 
 * CLI 스크래퍼의 결과(results/{boardId}/)를 
 * R2의 ScrapingData/{orgName}/{boardName}/{YYYY-MM}/ 형식으로 변환 후 업로드합니다.
 * 
 * 환경 변수 (필수):
 *   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * 
 * 사용법:
 *   npx ts-node scripts/upload-to-r2.ts --input=./results
 */

import fs from "node:fs";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

// ============================================================
// 설정
// ============================================================

interface Config {
  inputDir: string;
  dataPath: string;
}

function parseArgs(): Config {
  const config: Config = {
    inputDir: "./results",
    dataPath: "./data",
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--input=")) {
      config.inputDir = arg.slice("--input=".length);
    } else if (arg.startsWith("--data-path=")) {
      config.dataPath = arg.slice("--data-path=".length);
    }
  }

  return config;
}

// ============================================================
// R2 클라이언트
// ============================================================

function createR2Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 환경 변수 필요: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
    );
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function uploadToR2(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

// ============================================================
// 타겟 데이터 로드
// ============================================================

interface BoardInfo {
  board_id: string;
  org_id: string;
  board_name: string;
}

interface OrgInfo {
  org_id: string;
  org_name: string;
}

function loadTargets(dataPath: string): { orgs: OrgInfo[]; boards: BoardInfo[] } | null {
  const possiblePaths = [
    path.join(dataPath, "scraper-targets.json"),
    path.join(process.cwd(), "data", "scraper-targets.json"),
    path.join(process.cwd(), "frontend", "data", "scraper-targets.json"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8");
        const data = JSON.parse(content);
        return { orgs: data.orgs || [], boards: data.boards || [] };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function getMapping(
  targets: { orgs: OrgInfo[]; boards: BoardInfo[] },
  boardId: string
): { orgName: string; boardName: string } | null {
  const board = targets.boards.find((b) => b.board_id === boardId);
  if (!board) return null;
  const org = targets.orgs.find((o) => o.org_id === board.org_id);
  if (!org) return null;
  return { orgName: org.org_name, boardName: board.board_name };
}

// ============================================================
// MIME 타입 추정
// ============================================================

function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".hwp": "application/x-hwp",
    ".hwpx": "application/x-hwpx",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return mimeMap[ext] || "application/octet-stream";
}

// ============================================================
// 재귀적 파일 목록
// ============================================================

function listFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// ============================================================
// 메인
// ============================================================

async function main(): Promise<void> {
  const config = parseArgs();
  const inputDir = path.resolve(process.cwd(), config.inputDir);
  const bucket = process.env.R2_BUCKET_NAME || "webscraper-data";

  console.log("\n📤 R2 업로드 시작");
  console.log("=".repeat(50));
  console.log(`입력 경로: ${inputDir}`);
  console.log(`R2 버킷: ${bucket}`);

  if (!fs.existsSync(inputDir)) {
    console.log("⚠️ 결과 디렉토리가 없습니다. 업로드할 파일이 없습니다.");
    return;
  }

  const targets = loadTargets(config.dataPath);
  if (!targets) {
    console.warn("⚠️ scraper-targets.json을 찾을 수 없습니다.");
  } else {
    console.log(`✓ 타겟 로드: ${targets.orgs.length}개 기관, ${targets.boards.length}개 보드`);
  }

  const client = createR2Client();
  const now = new Date();
  const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  const boardDirs = fs.readdirSync(inputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  // API 결과 폴더도 처리
  const hasApiDir = boardDirs.includes("API");

  let totalUploaded = 0;
  let totalFailed = 0;

  for (const boardId of boardDirs) {
    if (boardId === "API") continue;

    const boardDir = path.join(inputDir, boardId);
    let orgName = boardId;
    let boardName = boardId;

    if (targets) {
      const mapping = getMapping(targets, boardId);
      if (mapping) {
        orgName = mapping.orgName;
        boardName = mapping.boardName;
        console.log(`\n📁 ${boardId} → ${orgName}/${boardName}`);
      } else {
        console.log(`\n📁 ${boardId} (매핑 없음)`);
      }
    }

    const r2Prefix = `ScrapingData/${orgName}/${boardName}/${dateFolder}`;

    // documents.json → 제목&본문.json
    const docsPath = path.join(boardDir, "documents.json");
    if (fs.existsSync(docsPath)) {
      const key = `${r2Prefix}/${dateStr}_${boardName}_제목&본문.json`;
      try {
        const body = fs.readFileSync(docsPath);
        await uploadToR2(client, bucket, key, body, "application/json");
        console.log(`  ✅ ${key}`);
        totalUploaded++;
      } catch (err: any) {
        console.error(`  ❌ ${key}: ${err.message}`);
        totalFailed++;
      }
    }

    // report.json
    const reportPath = path.join(boardDir, "report.json");
    if (fs.existsSync(reportPath)) {
      const key = `${r2Prefix}/${dateStr}_${boardName}_report.json`;
      try {
        const body = fs.readFileSync(reportPath);
        await uploadToR2(client, bucket, key, body, "application/json");
        console.log(`  ✅ ${key}`);
        totalUploaded++;
      } catch (err: any) {
        console.error(`  ❌ ${key}: ${err.message}`);
        totalFailed++;
      }
    }

    // 첨부파일
    const attachDir = path.join(boardDir, "attachments");
    if (fs.existsSync(attachDir)) {
      const files = listFilesRecursive(attachDir);
      for (const filePath of files) {
        const fileName = path.basename(filePath);
        const key = `${r2Prefix}/${fileName}`;
        try {
          const body = fs.readFileSync(filePath);
          await uploadToR2(client, bucket, key, body, guessMimeType(fileName));
          console.log(`  ✅ ${key}`);
          totalUploaded++;
        } catch (err: any) {
          console.error(`  ❌ ${key}: ${err.message}`);
          totalFailed++;
        }
      }
    }
  }

  // API 결과 업로드
  if (hasApiDir) {
    const apiDir = path.join(inputDir, "API");
    const apiFiles = listFilesRecursive(apiDir);
    if (apiFiles.length > 0) {
      console.log(`\n📁 API 결과 (${apiFiles.length}개 파일)`);
      for (const filePath of apiFiles) {
        const fileName = path.basename(filePath);
        const key = `ScrapingData/_API/${dateFolder}/${fileName}`;
        try {
          const body = fs.readFileSync(filePath);
          await uploadToR2(client, bucket, key, body, guessMimeType(fileName));
          console.log(`  ✅ ${key}`);
          totalUploaded++;
        } catch (err: any) {
          console.error(`  ❌ ${key}: ${err.message}`);
          totalFailed++;
        }
      }
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("📊 R2 업로드 완료");
  console.log("=".repeat(50));
  console.log(`업로드 성공: ${totalUploaded}개`);
  console.log(`업로드 실패: ${totalFailed}개`);
  console.log("=".repeat(50) + "\n");

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
