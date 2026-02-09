/**
 * Cloudflare R2 스토리지 클라이언트 (S3 호환 API)
 *
 * Railway 배포 환경에서 대용량 파일(첨부파일, 추출 텍스트, 청킹 데이터)을
 * Cloudflare R2에 저장/조회하기 위한 유틸리티 모듈.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

// ── 환경 변수 ──────────────────────────────────────────────
const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "webscraper-data";

// ── S3 호환 클라이언트 (싱글턴) ─────────────────────────────
let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error(
        "[R2] R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY 환경 변수가 필요합니다."
      );
    }
    _client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

// ── Public API ──────────────────────────────────────────────

/**
 * R2에 파일 업로드
 */
export async function uploadToR2(
  key: string,
  body: Buffer | string,
  contentType?: string
): Promise<void> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: typeof body === "string" ? Buffer.from(body, "utf-8") : body,
      ContentType: contentType,
    })
  );
}

/**
 * R2에서 파일 다운로드 (Buffer)
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const client = getClient();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })
  );
  return Buffer.from(await response.Body!.transformToByteArray());
}

/**
 * R2에서 파일 다운로드 (문자열 / UTF-8)
 */
export async function downloadTextFromR2(key: string): Promise<string> {
  const buf = await downloadFromR2(key);
  return buf.toString("utf-8");
}

/**
 * R2 파일 목록 조회
 */
export async function listR2Objects(
  prefix: string
): Promise<{ Key?: string; Size?: number; LastModified?: Date }[]> {
  const client = getClient();
  const allContents: { Key?: string; Size?: number; LastModified?: Date }[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    if (response.Contents) {
      allContents.push(...response.Contents);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return allContents;
}

/**
 * R2 파일 삭제
 */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })
  );
}

/**
 * R2 파일 존재 여부 확인
 */
export async function existsInR2(key: string): Promise<boolean> {
  try {
    const client = getClient();
    await client.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      })
    );
    return true;
  } catch {
    return false;
  }
}
