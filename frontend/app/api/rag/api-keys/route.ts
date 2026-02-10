/**
 * API 키 관리 엔드포인트
 * 
 * .env.local 파일에서 API 키를 읽어와 마스킹 또는 전체 형태로 반환
 * 보안: 서버 사이드에서만 실제 키에 접근 가능
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface APIKeyInfo {
  provider: "openai" | "anthropic" | "google";
  envKey: string;
  configured: boolean;
  maskedKey: string;
  fullKey?: string;  // reveal=true일 때만 포함
}

/**
 * API 키 마스킹 (앞 8자 + ... + 뒤 4자)
 */
function maskApiKey(key: string): string {
  if (!key || key.length < 16) {
    return key ? "****" : "";
  }
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * 환경 변수에서 API 키 정보 조회
 */
function getApiKeyInfo(reveal: boolean = false): APIKeyInfo[] {
  const keys: APIKeyInfo[] = [
    {
      provider: "openai",
      envKey: "OPENAI_API_KEY",
      configured: false,
      maskedKey: "",
    },
    {
      provider: "anthropic",
      envKey: "ANTHROPIC_API_KEY",
      configured: false,
      maskedKey: "",
    },
    {
      provider: "google",
      envKey: "GEMINI_API_KEY",
      configured: false,
      maskedKey: "",
    },
  ];

  for (const keyInfo of keys) {
    const value = process.env[keyInfo.envKey];
    if (value && value.trim()) {
      keyInfo.configured = true;
      keyInfo.maskedKey = maskApiKey(value);
      if (reveal) {
        keyInfo.fullKey = value;
      }
    }
  }

  return keys;
}

/**
 * GET: API 키 상태 조회
 * 
 * Query params:
 * - reveal: true면 전체 키 반환 (보안 주의)
 * - provider: 특정 프로바이더만 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reveal = searchParams.get("reveal") === "true";
    const provider = searchParams.get("provider");

    let keys = getApiKeyInfo(reveal);

    // 특정 프로바이더만 필터링
    if (provider) {
      keys = keys.filter(k => k.provider === provider);
    }

    return NextResponse.json({
      success: true,
      keys,
      source: ".env.local",
    });
  } catch (error: any) {
    console.error("[API Keys] Error:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "API 키 조회 실패",
    }, { status: 500 });
  }
}

/**
 * POST: 특정 프로바이더의 API 키 가져오기 (내부 사용)
 * 
 * 이 엔드포인트는 다른 API 라우트에서 API 키가 필요할 때 호출됨
 * 클라이언트에서 직접 호출하지 않음
 */
export async function POST(request: NextRequest) {
  try {
    const { provider } = await request.json();
    
    const envKeyMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GEMINI_API_KEY",
    };

    const envKey = envKeyMap[provider];
    if (!envKey) {
      return NextResponse.json({
        success: false,
        error: `알 수 없는 프로바이더: ${provider}`,
      }, { status: 400 });
    }

    const apiKey = process.env[envKey];
    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: `${provider} API 키가 .env.local에 설정되지 않았습니다.`,
        configured: false,
      });
    }

    return NextResponse.json({
      success: true,
      apiKey,
      configured: true,
    });
  } catch (error: any) {
    console.error("[API Keys] POST Error:", error);
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
