/**
 * 스트리밍 텍스트 추출 API Route (SSE)
 * 실시간 진행 상황 전송
 */
import { NextRequest } from "next/server";

const BACKEND_URL = process.env.EXTRACTION_BACKEND_URL || "http://localhost:8000";

/**
 * POST /api/processing/extract/stream
 * 스트리밍 배치 추출 (Server-Sent Events)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { file_paths, config, settings, is_retry } = body;

    if (!file_paths || !Array.isArray(file_paths) || file_paths.length === 0) {
      return new Response(
        JSON.stringify({ error: "file_paths array is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // settings를 백엔드 config 형식으로 변환
    const extractionConfig = settings || config;
    
    // Python 백엔드의 SSE 스트림에 연결
    console.log(`[Stream API] Connecting to backend: ${BACKEND_URL}/extract/stream`);
    console.log(`[Stream API] Files: ${file_paths.length}개, is_retry: ${is_retry || false}`);
    if (extractionConfig) {
      console.log(`[Stream API] Config:`, JSON.stringify(extractionConfig, null, 2));
    }
    
    let backendResponse;
    try {
      backendResponse = await fetch(`${BACKEND_URL}/extract/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          file_paths, 
          config: extractionConfig,
          is_retry: is_retry || false,
        }),
      });
    } catch (fetchError: any) {
      console.error("[Stream API] Backend connection failed:", fetchError.message);
      return new Response(
        JSON.stringify({ 
          error: "백엔드 서버 연결 실패", 
          message: `Python 백엔드 서버(${BACKEND_URL})에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.`,
          details: fetchError.message 
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text().catch(() => "Unknown error");
      console.error("[Stream API] Backend error:", backendResponse.status, errorText);
      return new Response(
        JSON.stringify({ 
          error: "백엔드 처리 실패", 
          message: `HTTP ${backendResponse.status}: ${errorText}`,
          status: backendResponse.status 
        }),
        { status: backendResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }
    
    console.log("[Stream API] Backend connected, starting stream...");

    // 스트림 프록시
    const stream = new ReadableStream({
      async start(controller) {
        const reader = backendResponse.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            controller.enqueue(new TextEncoder().encode(text));
          }
        } catch (error) {
          console.error("[Stream] Error:", error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API] Stream error:", error);
    return new Response(
      JSON.stringify({ error: "Stream failed", details: String(error) }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}
