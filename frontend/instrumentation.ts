/**
 * Next.js Instrumentation
 * 
 * 서버 시작 시 자동으로 실행되어 설정 파일 무결성 검증 및 스케줄러를 초기화합니다.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 서버 사이드에서만 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("\n========================================");
    console.log("🚀 Web Scraper 서버 시작");
    console.log("========================================\n");

    try {
      // [1] 설정 파일 무결성 검증 및 복원
      const { ensureConfigFiles } = await import("./lib/server/ensure-config");
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
