/**
 * API 키 검증 API
 * POST: API 키 유효성 검증
 */

import { NextRequest, NextResponse } from "next/server";
import {
  validateAPIKey,
  LLMProvider,
  loadRAGSettings,
  saveRAGSettings,
} from "@/lib/rag/rag-settings";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, saveIfValid } = body as {
      provider: LLMProvider;
      apiKey: string;
      saveIfValid?: boolean;
    };
    
    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: "provider와 apiKey가 필요합니다." },
        { status: 400 }
      );
    }
    
    if (!["openai", "anthropic", "google"].includes(provider)) {
      return NextResponse.json(
        { error: "유효하지 않은 provider입니다." },
        { status: 400 }
      );
    }
    
    // API 키 검증
    const result = await validateAPIKey(provider, apiKey);
    
    // 검증 성공 & 저장 옵션이 활성화된 경우
    if (result.valid && saveIfValid) {
      const settings = loadRAGSettings();
      settings.llm.apiKeys[provider] = apiKey;
      saveRAGSettings(settings);
    }
    
    return NextResponse.json({
      provider,
      valid: result.valid,
      error: result.error,
      saved: result.valid && saveIfValid,
    });
  } catch (error: any) {
    console.error("Failed to validate API key:", error);
    return NextResponse.json(
      { error: error.message || "검증에 실패했습니다." },
      { status: 500 }
    );
  }
}
