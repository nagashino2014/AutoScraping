/**
 * Next.js Instrumentation
 * 
 * 서버 시작 시 자동으로 실행되어 스케줄러를 초기화합니다.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // 서버 사이드에서만 실행
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("\n========================================");
    console.log("🚀 Web Scraper 서버 시작");
    console.log("========================================\n");

    try {
      // 동적 import로 스케줄러 로드 (클라이언트 번들에 포함되지 않도록)
      const { initializeScheduler } = await import("./lib/scraper/scheduler");
      
      // 스케줄러 초기화
      initializeScheduler();
      
      console.log("\n========================================");
      console.log("✅ 서버 초기화 완료");
      console.log("========================================\n");
    } catch (err) {
      console.error("[Instrumentation] 스케줄러 초기화 실패:", err);
    }
  }
}
