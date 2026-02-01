#!/usr/bin/env npx ts-node
/**
 * GitHub Actions Artifact 동기화 스크립트
 * 
 * GitHub Actions에서 생성된 스크래핑 결과(Artifact)를 로컬로 다운로드합니다.
 * 
 * 사용법:
 *   npx ts-node scripts/sync-from-github.ts
 *   npx ts-node scripts/sync-from-github.ts --hours=48
 *   npx ts-node scripts/sync-from-github.ts --output=./downloaded
 * 
 * 환경 변수:
 *   GITHUB_TOKEN: GitHub Personal Access Token (필수)
 *   GITHUB_REPO: 저장소 이름 (owner/repo 형식, 필수)
 * 
 * 옵션:
 *   --hours=<n>       최근 N시간 내 Artifact만 (기본: 24)
 *   --output=<path>   저장 경로 (기본: ./save/ScrapingData)
 *   --workflow=<name> 워크플로우 이름 필터 (기본: Scheduled Scraping)
 *   --dry-run         다운로드 없이 목록만 표시
 *   --help            도움말
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createWriteStream, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require("adm-zip");

// ============================================================
// 환경 변수 및 설정
// ============================================================

interface Config {
  githubToken: string;
  githubRepo: string;
  hoursBack: number;
  outputDir: string;
  workflowName: string;
  dryRun: boolean;
}

function loadConfig(): Config {
  // .env.local 파일 로드 시도
  const envPath = path.join(process.cwd(), ".env.local");
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    // Windows 줄바꿈 처리
    const lines = envContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    
    for (const line of lines) {
      // 주석과 빈 줄 무시, 대소문자 및 숫자 포함 변수명 허용
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }

  return {
    githubToken: process.env.GITHUB_TOKEN || "",
    githubRepo: process.env.GITHUB_REPO || "",
    hoursBack: 24,
    outputDir: "./save/ScrapingData",
    workflowName: "Scheduled Scraping",
    dryRun: false,
  };
}

function parseArgs(args: string[], config: Config): Config {
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (arg === "--dry-run") {
      config.dryRun = true;
    } else if (arg.startsWith("--hours=")) {
      const val = parseInt(arg.slice("--hours=".length), 10);
      if (!isNaN(val) && val > 0) {
        config.hoursBack = val;
      }
    } else if (arg.startsWith("--output=")) {
      config.outputDir = arg.slice("--output=".length);
    } else if (arg.startsWith("--workflow=")) {
      config.workflowName = arg.slice("--workflow=".length);
    }
  }
  return config;
}

function showHelp(): void {
  console.log(`
GitHub Actions Artifact 동기화 스크립트

사용법:
  npx ts-node scripts/sync-from-github.ts [옵션]

환경 변수 (.env.local에 설정):
  GITHUB_TOKEN      GitHub Personal Access Token (필수)
  GITHUB_REPO       저장소 이름 (owner/repo 형식, 필수)

옵션:
  --hours=<n>       최근 N시간 내 Artifact만 다운로드 (기본: 24)
  --output=<path>   저장 경로 (기본: ./save/ScrapingData)
  --workflow=<name> 워크플로우 이름 필터 (기본: Scheduled Scraping)
  --dry-run         다운로드 없이 목록만 표시
  --help, -h        도움말

예시:
  # 기본 실행 (최근 24시간)
  npx ts-node scripts/sync-from-github.ts

  # 최근 48시간 내 결과 동기화
  npx ts-node scripts/sync-from-github.ts --hours=48

  # 목록만 확인
  npx ts-node scripts/sync-from-github.ts --dry-run
`);
}

// ============================================================
// GitHub API 헬퍼
// ============================================================

interface Artifact {
  id: number;
  name: string;
  size_in_bytes: number;
  archive_download_url: string;
  created_at: string;
  expires_at: string;
  workflow_run?: {
    id: number;
    head_branch: string;
  };
}

interface ArtifactsResponse {
  total_count: number;
  artifacts: Artifact[];
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Web-Scraper-Sync/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    https.get(url, options, (res) => {
      if (res.statusCode === 302 && res.headers.location) {
        // 리다이렉트 따라가기
        fetchJson<T>(res.headers.location, token).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(err);
        }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function downloadArtifact(
  url: string,
  token: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Web-Scraper-Sync/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    const makeRequest = (requestUrl: string) => {
      https.get(requestUrl, options, (res) => {
        if (res.statusCode === 302 && res.headers.location) {
          // 리다이렉트 따라가기 (S3 등)
          https.get(res.headers.location, (redirectRes) => {
            if (redirectRes.statusCode !== 200) {
              reject(new Error(`Download failed: HTTP ${redirectRes.statusCode}`));
              return;
            }

            mkdirSync(path.dirname(outputPath), { recursive: true });
            const fileStream = createWriteStream(outputPath);
            
            redirectRes.pipe(fileStream);
            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });
            fileStream.on("error", reject);
          }).on("error", reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        mkdirSync(path.dirname(outputPath), { recursive: true });
        const fileStream = createWriteStream(outputPath);
        
        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          resolve();
        });
        fileStream.on("error", reject);
      }).on("error", reject);
    };

    makeRequest(url);
  });
}

// ============================================================
// ZIP 추출
// ============================================================

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  
  mkdirSync(outputDir, { recursive: true });
  zip.extractAllTo(outputDir, true);
}

// ============================================================
// 메인 로직
// ============================================================

async function main(): Promise<void> {
  let config = loadConfig();
  config = parseArgs(process.argv.slice(2), config);

  // 환경 변수 확인
  if (!config.githubToken) {
    console.error("❌ GITHUB_TOKEN 환경 변수가 설정되지 않았습니다.");
    console.error("   .env.local 파일에 다음을 추가하세요:");
    console.error("   GITHUB_TOKEN=ghp_xxxxxxxxxxxx");
    process.exit(1);
  }

  if (!config.githubRepo) {
    console.error("❌ GITHUB_REPO 환경 변수가 설정되지 않았습니다.");
    console.error("   .env.local 파일에 다음을 추가하세요:");
    console.error("   GITHUB_REPO=username/repository-name");
    process.exit(1);
  }

  console.log("\n📥 GitHub Artifact 동기화");
  console.log("=".repeat(50));
  console.log(`저장소: ${config.githubRepo}`);
  console.log(`기간: 최근 ${config.hoursBack}시간`);
  console.log(`저장 경로: ${config.outputDir}`);
  console.log(`Dry Run: ${config.dryRun ? "예" : "아니오"}`);
  console.log("=".repeat(50) + "\n");

  // Artifact 목록 가져오기
  console.log("📋 Artifact 목록 조회 중...");
  
  const apiUrl = `https://api.github.com/repos/${config.githubRepo}/actions/artifacts?per_page=100`;
  
  let response: ArtifactsResponse;
  try {
    response = await fetchJson<ArtifactsResponse>(apiUrl, config.githubToken);
  } catch (err: any) {
    console.error(`❌ API 호출 실패: ${err.message}`);
    process.exit(1);
  }

  console.log(`총 ${response.total_count}개의 Artifact 발견\n`);

  // 시간 필터링
  const cutoffTime = new Date();
  cutoffTime.setHours(cutoffTime.getHours() - config.hoursBack);

  const filteredArtifacts = response.artifacts.filter((artifact) => {
    const createdAt = new Date(artifact.created_at);
    const nameMatch = artifact.name.startsWith("scrape-results-");
    const timeMatch = createdAt >= cutoffTime;
    return nameMatch && timeMatch;
  });

  console.log(`📦 다운로드 대상: ${filteredArtifacts.length}개\n`);

  if (filteredArtifacts.length === 0) {
    console.log("다운로드할 Artifact가 없습니다.");
    return;
  }

  // Artifact 목록 출력
  for (const artifact of filteredArtifacts) {
    const createdAt = new Date(artifact.created_at);
    const sizeKb = (artifact.size_in_bytes / 1024).toFixed(1);
    console.log(`  - ${artifact.name}`);
    console.log(`    생성: ${createdAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`);
    console.log(`    크기: ${sizeKb} KB\n`);
  }

  if (config.dryRun) {
    console.log("(Dry Run 모드 - 다운로드 건너뜀)");
    return;
  }

  // 다운로드 및 추출
  const tempDir = path.join(process.cwd(), ".temp-artifacts");
  mkdirSync(tempDir, { recursive: true });

  let successCount = 0;
  let failCount = 0;

  for (const artifact of filteredArtifacts) {
    console.log(`\n⬇️ 다운로드: ${artifact.name}...`);
    
    const zipPath = path.join(tempDir, `${artifact.name}.zip`);
    const extractDir = path.join(tempDir, artifact.name);
    
    try {
      // 다운로드
      await downloadArtifact(artifact.archive_download_url, config.githubToken, zipPath);
      console.log(`  ✓ 다운로드 완료`);

      // ZIP 추출
      await extractZip(zipPath, extractDir);
      console.log(`  ✓ 압축 해제 완료`);

      // 파일 이동 (보드별로 정리)
      const boardDirs = fs.readdirSync(extractDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const boardId of boardDirs) {
        const sourcePath = path.join(extractDir, boardId);
        const destPath = path.join(config.outputDir, boardId);
        
        // 날짜별 폴더 생성
        const now = new Date();
        const dateFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const finalDestPath = path.join(destPath, dateFolder);
        
        mkdirSync(finalDestPath, { recursive: true });

        // documents.json 복사
        const docsSource = path.join(sourcePath, "documents.json");
        if (fs.existsSync(docsSource)) {
          const docsContent = fs.readFileSync(docsSource, "utf8");
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const docsDest = path.join(finalDestPath, `documents_${timestamp}.json`);
          fs.writeFileSync(docsDest, docsContent);
          console.log(`  📄 문서 저장: ${docsDest}`);
        }

        // 첨부파일 복사
        const attachSource = path.join(sourcePath, "attachments");
        if (fs.existsSync(attachSource)) {
          const attachDest = path.join(finalDestPath, "attachments");
          mkdirSync(attachDest, { recursive: true });

          const files = fs.readdirSync(attachSource);
          for (const file of files) {
            const src = path.join(attachSource, file);
            const dest = path.join(attachDest, file);
            
            // 파일 중복 체크
            if (!fs.existsSync(dest)) {
              fs.copyFileSync(src, dest);
            }
          }
          console.log(`  📎 첨부파일 ${files.length}개 저장`);
        }
      }

      successCount++;

    } catch (err: any) {
      console.error(`  ❌ 실패: ${err.message}`);
      failCount++;
    }

    // 임시 파일 정리
    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // 임시 디렉토리 정리
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}

  // 동기화 로그 저장
  const logPath = path.join(config.outputDir, "sync-log.json");
  const logEntry = {
    syncedAt: new Date().toISOString(),
    artifactsProcessed: filteredArtifacts.length,
    success: successCount,
    failed: failCount,
    artifacts: filteredArtifacts.map(a => ({
      name: a.name,
      createdAt: a.created_at,
      size: a.size_in_bytes,
    })),
  };

  let logs: any[] = [];
  if (fs.existsSync(logPath)) {
    try {
      logs = JSON.parse(fs.readFileSync(logPath, "utf8"));
    } catch {}
  }
  logs.push(logEntry);
  
  // 최근 100개만 유지
  if (logs.length > 100) {
    logs = logs.slice(-100);
  }
  
  mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), "utf8");

  // 최종 요약
  console.log("\n" + "=".repeat(50));
  console.log("📊 동기화 완료");
  console.log("=".repeat(50));
  console.log(`성공: ${successCount}개`);
  console.log(`실패: ${failCount}개`);
  console.log(`저장 위치: ${config.outputDir}`);
  console.log("=".repeat(50) + "\n");

  process.exit(failCount > 0 ? 1 : 0);
}

// 실행
main().catch(err => {
  console.error("치명적 오류:", err);
  process.exit(1);
});
