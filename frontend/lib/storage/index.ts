/**
 * 스토리지 추상화 레이어
 *
 * R2_ENDPOINT 환경 변수가 설정되어 있으면 Cloudflare R2,
 * 없으면 로컬 파일 시스템을 사용합니다.
 *
 * 사용 예:
 *   import { storage } from "@/lib/storage";
 *   await storage.upload("ScrapingData/기관/보드/2026-01/file.pdf", buffer);
 *   const data = await storage.download("chunk/기관/보드/2026-01/chunks.json");
 */
import * as localStorage from "./local";
import * as r2Storage from "./r2-client";

const USE_R2 = !!process.env.R2_ENDPOINT;

export const storage = {
  /** 파일 업로드 (R2 또는 로컬) */
  upload: USE_R2 ? r2Storage.uploadToR2 : localStorage.writeFile,

  /** 파일 다운로드 - Buffer 반환 (R2 또는 로컬) */
  download: USE_R2 ? r2Storage.downloadFromR2 : localStorage.readFile,

  /** 파일 목록 조회 (prefix 기반) */
  list: USE_R2 ? r2Storage.listR2Objects : localStorage.listFiles,

  /** 파일 삭제 */
  delete: USE_R2 ? r2Storage.deleteFromR2 : localStorage.deleteFile,

  /** 파일 존재 여부 확인 */
  exists: USE_R2 ? r2Storage.existsInR2 : localStorage.existsFile,

  /** 현재 스토리지 백엔드 종류 */
  backend: USE_R2 ? ("r2" as const) : ("local" as const),
};

/**
 * 텍스트(UTF-8) 파일 다운로드 헬퍼
 */
export async function downloadText(key: string): Promise<string> {
  if (USE_R2) {
    return r2Storage.downloadTextFromR2(key);
  }
  const buf = await localStorage.readFile(key);
  return buf.toString("utf-8");
}

/**
 * JSON 파일 업로드 헬퍼
 */
export async function uploadJson(key: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await storage.upload(key, json, "application/json");
}

/**
 * JSON 파일 다운로드 & 파싱 헬퍼
 */
export async function downloadJson<T = unknown>(key: string): Promise<T> {
  const text = await downloadText(key);
  return JSON.parse(text) as T;
}
