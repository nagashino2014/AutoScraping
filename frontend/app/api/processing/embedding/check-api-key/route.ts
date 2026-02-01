/**
 * OpenAI API 키 존재 여부 확인 API
 * 
 * GET /api/processing/embedding/check-api-key
 * - 환경 변수에 OPENAI_API_KEY가 설정되어 있는지 확인합니다
 */

import { NextResponse } from "next/server";

export async function GET() {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  return NextResponse.json({
    success: true,
    hasApiKey,
    // 보안을 위해 실제 키 값은 반환하지 않음
  });
}
