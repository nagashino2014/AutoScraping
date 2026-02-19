/**
 * Next.js Instrumentation
 * 
 * 서버 시작 시 자동으로 실행되어 설정 파일 무결성 검증 및 스케줄러를 초기화합니다.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

/**
 * Railway 볼륨 유실 대비 — data-defaults → data 설정 파일 복원
 * Docker entrypoint 와 동일한 역할을 Node.js 레벨에서 이중으로 수행한다.
 */
async function ensureConfigFiles() {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const cwd = process.cwd();
  const dataDefaultsDir = path.join(cwd, "data-defaults");
  if (!fs.existsSync(dataDefaultsDir)) return;

  const dataDir = path.join(cwd, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const CONFIG_FILES = [
    "scraper-targets.json",
    "embedding-settings.json",
    "model-mappings.json",
    "download-settings.json",
    "users.json",
  ];

  let restored = 0;
  for (const file of CONFIG_FILES) {
    const src = path.join(dataDefaultsDir, file);
    const dest = path.join(dataDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      restored++;
      console.log(`[Sync] 설정 파일 업데이트: ${file}`);
    }
  }

  const CONFIG_DIRS = ["site-profiles", "APISet"];
  for (const dir of CONFIG_DIRS) {
    const srcDir = path.join(dataDefaultsDir, dir);
    const destDir = path.join(dataDir, dir);
    if (fs.existsSync(srcDir) && !fs.existsSync(destDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
      restored++;
      console.log(`[Sync] 설정 디렉토리 업데이트: ${dir}`);
    }
  }

  if (restored > 0) {
    console.log(`[Sync] ${restored}개 설정 복원 완료 (data-defaults → data)`);
  }
}

export async function register() {
  // 서버 사이드에서만 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("\n========================================");
    console.log("🚀 Web Scraper 서버 시작");
    console.log("========================================\n");

    try {
      // [1] 설정 파일 무결성 검증 및 복원
      await ensureConfigFiles();

      // [2] 스케줄러 초기화
      const { initializeScheduler } = await import("./lib/scraper/scheduler");
      initializeScheduler();
      
      console.log("\n========================================");
      console.log("✅ 서버 초기화 완료");
      console.log("========================================\n");
    } catch (err) {
      console.error("[Instrumentation] 초기화 실패:", err);
    }
  }
}
