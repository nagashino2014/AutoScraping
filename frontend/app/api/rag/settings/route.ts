/**
 * RAG 설정 API
 * GET: 설정 조회
 * PUT: 설정 저장
 * DELETE: 설정 초기화
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadRAGSettings,
  saveRAGSettings,
  resetRAGSettings,
  RAGSettings,
  maskAPIKey,
} from "@/lib/rag/rag-settings";

/**
 * GET: RAG 설정 조회
 */
export async function GET(req: NextRequest) {
  try {
    const settings = loadRAGSettings();
    
    // API 키 마스킹 (보안)
    const maskedSettings = {
      ...settings,
      llm: {
        ...settings.llm,
        apiKeys: {
          openai: maskAPIKey(settings.llm.apiKeys.openai),
          anthropic: maskAPIKey(settings.llm.apiKeys.anthropic),
          google: maskAPIKey(settings.llm.apiKeys.google),
        },
        // 검증 상태 추가
        apiKeyStatus: {
          openai: settings.llm.apiKeys.openai ? "configured" : "not_configured",
          anthropic: settings.llm.apiKeys.anthropic ? "configured" : "not_configured",
          google: settings.llm.apiKeys.google ? "configured" : "not_configured",
        },
      },
    };
    
    return NextResponse.json(maskedSettings);
  } catch (error: any) {
    console.error("Failed to load RAG settings:", error);
    return NextResponse.json(
      { error: error.message || "설정 로드에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * PUT: RAG 설정 저장
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 현재 설정 로드
    const currentSettings = loadRAGSettings();
    
    // API 키는 마스킹된 값이 아닌 경우에만 업데이트
    const newApiKeys = { ...currentSettings.llm.apiKeys };
    
    if (body.llm?.apiKeys) {
      // OpenAI
      if (body.llm.apiKeys.openai && !body.llm.apiKeys.openai.includes("...")) {
        newApiKeys.openai = body.llm.apiKeys.openai;
      }
      // Anthropic
      if (body.llm.apiKeys.anthropic && !body.llm.apiKeys.anthropic.includes("...")) {
        newApiKeys.anthropic = body.llm.apiKeys.anthropic;
      }
      // Google
      if (body.llm.apiKeys.google && !body.llm.apiKeys.google.includes("...")) {
        newApiKeys.google = body.llm.apiKeys.google;
      }
    }
    
    // 설정 병합
    const updatedSettings: RAGSettings = {
      ...currentSettings,
      ...body,
      llm: {
        ...currentSettings.llm,
        ...body.llm,
        apiKeys: newApiKeys,
      },
      updatedAt: new Date().toISOString(),
    };
    
    // 저장
    const result = saveRAGSettings(updatedSettings);
    
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "저장에 실패했습니다." },
        { status: 500 }
      );
    }
    
    // 마스킹된 설정 반환
    const maskedSettings = {
      ...updatedSettings,
      llm: {
        ...updatedSettings.llm,
        apiKeys: {
          openai: maskAPIKey(updatedSettings.llm.apiKeys.openai),
          anthropic: maskAPIKey(updatedSettings.llm.apiKeys.anthropic),
          google: maskAPIKey(updatedSettings.llm.apiKeys.google),
        },
        apiKeyStatus: {
          openai: updatedSettings.llm.apiKeys.openai ? "configured" : "not_configured",
          anthropic: updatedSettings.llm.apiKeys.anthropic ? "configured" : "not_configured",
          google: updatedSettings.llm.apiKeys.google ? "configured" : "not_configured",
        },
      },
    };
    
    return NextResponse.json({
      ok: true,
      settings: maskedSettings,
    });
  } catch (error: any) {
    console.error("Failed to save RAG settings:", error);
    return NextResponse.json(
      { error: error.message || "저장에 실패했습니다." },
      { status: 500 }
    );
  }
}

/**
 * DELETE: RAG 설정 초기화
 */
export async function DELETE(req: NextRequest) {
  try {
    const settings = resetRAGSettings();
    
    // 마스킹된 설정 반환
    const maskedSettings = {
      ...settings,
      llm: {
        ...settings.llm,
        apiKeys: {
          openai: maskAPIKey(settings.llm.apiKeys.openai),
          anthropic: maskAPIKey(settings.llm.apiKeys.anthropic),
          google: maskAPIKey(settings.llm.apiKeys.google),
        },
        apiKeyStatus: {
          openai: "not_configured",
          anthropic: "not_configured",
          google: "not_configured",
        },
      },
    };
    
    return NextResponse.json({
      ok: true,
      settings: maskedSettings,
    });
  } catch (error: any) {
    console.error("Failed to reset RAG settings:", error);
    return NextResponse.json(
      { error: error.message || "초기화에 실패했습니다." },
      { status: 500 }
    );
  }
}
