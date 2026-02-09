/**
 * 로컬 파일 시스템 스토리지 모듈
 *
 * R2를 사용하지 않는 로컬 개발 환경에서 동일한 인터페이스로
 * 파일을 읽고 쓰기 위한 유틸리티.
 */
import fs from "fs";
import path from "path";

/**
 * 로컬 파일 쓰기 (디렉토리 자동 생성)
 *
 * @param key  저장 경로 (R2 key와 동일한 상대 경로, 예: "ScrapingData/기관/보드/2026-01/file.pdf")
 * @param body 파일 내용
 */
export async function writeFile(
  key: string,
  body: Buffer | string,
  _contentType?: string
): Promise<void> {
  const absPath = resolveLocalPath(key);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, body);
}

/**
 * 로컬 파일 읽기 (Buffer)
 */
export async function readFile(key: string): Promise<Buffer> {
  const absPath = resolveLocalPath(key);
  if (!fs.existsSync(absPath)) {
    throw new Error(`[LocalStorage] 파일 없음: ${absPath}`);
  }
  return fs.readFileSync(absPath);
}

/**
 * 로컬 파일 목록 조회
 *
 * prefix 디렉토리 아래 모든 파일을 재귀적으로 탐색하여 반환합니다.
 */
export async function listFiles(
  prefix: string
): Promise<{ Key?: string; Size?: number; LastModified?: Date }[]> {
  const absDir = resolveLocalPath(prefix);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    return [];
  }
  const results: { Key?: string; Size?: number; LastModified?: Date }[] = [];
  walkDir(absDir, prefix, results);
  return results;
}

/**
 * 로컬 파일 삭제
 */
export async function deleteFile(key: string): Promise<void> {
  const absPath = resolveLocalPath(key);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }
}

/**
 * 로컬 파일 존재 여부 확인
 */
export async function existsFile(key: string): Promise<boolean> {
  return fs.existsSync(resolveLocalPath(key));
}

// ── 내부 유틸 ────────────────────────────────────────────────

/**
 * R2 key를 로컬 절대 경로로 변환.
 *
 * R2 폴더 구조 기준:
 *   ScrapingData/...  → <cwd>/save/ScrapingData/...
 *   ExtractedData/... → <cwd>/save/ExtractedData/...
 *   chunk/...         → <cwd>/chunk/...
 *   기타              → <cwd>/save/<key>
 */
function resolveLocalPath(key: string): string {
  const cwd = process.cwd();

  if (key.startsWith("ScrapingData/")) {
    return path.join(cwd, "save", key);
  }
  if (key.startsWith("ExtractedData/")) {
    return path.join(cwd, "save", key);
  }
  if (key.startsWith("chunk/")) {
    return path.join(cwd, key);
  }
  // 기본 fallback
  return path.join(cwd, "save", key);
}

function walkDir(
  dir: string,
  prefix: string,
  results: { Key?: string; Size?: number; LastModified?: Date }[]
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, prefix, results);
    } else {
      const stat = fs.statSync(full);
      // 절대 경로 → R2 key 형식으로 변환
      const cwd = process.cwd();
      let rel = path.relative(cwd, full).replace(/\\/g, "/");
      // save/ 접두사 제거 (ScrapingData, ExtractedData)
      if (rel.startsWith("save/")) {
        rel = rel.slice(5);
      }
      results.push({
        Key: rel,
        Size: stat.size,
        LastModified: stat.mtime,
      });
    }
  }
}
