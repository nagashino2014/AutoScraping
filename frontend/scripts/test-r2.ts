/**
 * R2 연결 테스트 스크립트
 * 실행: npx ts-node --project scripts/tsconfig.json scripts/test-r2.ts
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
import * as path from "path";

// .env.local 로드
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "webscraper-data";

async function main() {
  console.log("========================================");
  console.log("  Cloudflare R2 연결 테스트");
  console.log("========================================\n");

  // 1. 환경 변수 확인
  console.log("[1/5] 환경 변수 확인...");
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    console.error("  ✗ R2 환경 변수가 설정되지 않았습니다.");
    console.error("    필요: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }
  console.log(`  ✓ Endpoint: ${R2_ENDPOINT}`);
  console.log(`  ✓ Access Key ID: ${R2_ACCESS_KEY_ID.slice(0, 8)}...`);
  console.log(`  ✓ Bucket: ${R2_BUCKET_NAME}\n`);

  // 2. 클라이언트 생성
  const client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const testKey = "_test/r2-connection-test.txt";
  const testContent = `R2 연결 테스트 - ${new Date().toISOString()}`;

  try {
    // 3. 파일 업로드
    console.log("[2/5] 파일 업로드 테스트...");
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: testKey,
        Body: testContent,
        ContentType: "text/plain; charset=utf-8",
      })
    );
    console.log(`  ✓ 업로드 성공: ${testKey}\n`);

    // 4. 파일 다운로드
    console.log("[3/5] 파일 다운로드 테스트...");
    const getResponse = await client.send(
      new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: testKey,
      })
    );
    const downloaded = await getResponse.Body!.transformToString();
    if (downloaded === testContent) {
      console.log(`  ✓ 다운로드 성공 (내용 일치 확인됨)\n`);
    } else {
      console.error(`  ✗ 다운로드 내용 불일치!`);
      process.exit(1);
    }

    // 5. 목록 조회
    console.log("[4/5] 파일 목록 조회 테스트...");
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET_NAME,
        Prefix: "_test/",
      })
    );
    const files = listResponse.Contents || [];
    console.log(`  ✓ 목록 조회 성공 (${files.length}개 파일)\n`);

    // 6. 파일 삭제
    console.log("[5/5] 파일 삭제 테스트 (정리)...");
    await client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: testKey,
      })
    );
    console.log(`  ✓ 삭제 성공\n`);

    console.log("========================================");
    console.log("  ✓ 모든 테스트 통과! R2 연결 정상");
    console.log("========================================");
  } catch (err: any) {
    console.error("\n  ✗ 오류 발생:", err.message);
    if (err.Code === "AccessDenied" || err.name === "AccessDenied") {
      console.error("    → API 토큰 권한을 확인하세요 (Object Read & Write 필요)");
    }
    if (err.Code === "NoSuchBucket" || err.name === "NoSuchBucket") {
      console.error(`    → 버킷 '${R2_BUCKET_NAME}'이 존재하는지 확인하세요`);
    }
    process.exit(1);
  }
}

main();
