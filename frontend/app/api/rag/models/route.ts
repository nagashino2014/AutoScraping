/**
 * 모델 매핑 관리 API
 * 
 * GET: 현재 모델 매핑 및 상태 조회
 * POST: 모델 매핑 수동 업데이트
 * PUT: 설정 변경 (자동 업데이트 활성화/비활성화)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadModelMappings,
  saveModelMappings,
  updateModelMappings,
  needsUpdate,
  setAutoUpdate,
  setModelMapping,
  getActualModelId,
} from "@/lib/rag/model-mappings";

export const runtime = "nodejs";

/**
 * GET: 모델 매핑 상태 조회
 */
export async function GET(request: NextRequest) {
  try {
    const mappings = loadModelMappings();
    const updateNeeded = needsUpdate();
    
    return NextResponse.json({
      success: true,
      mappings: mappings.mappings,
      availableModels: mappings.availableModels,
      lastUpdated: mappings.lastUpdated,
      autoUpdateEnabled: mappings.autoUpdateEnabled,
      updateIntervalDays: mappings.updateIntervalDays,
      updateNeeded,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST: 모델 목록 업데이트 실행
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // API 키 가져오기 (환경변수 우선)
    const apiKeys = {
      openai: process.env.OPENAI_API_KEY || body.apiKeys?.openai,
      anthropic: process.env.ANTHROPIC_API_KEY || body.apiKeys?.anthropic,
      google: process.env.GEMINI_API_KEY || body.apiKeys?.google,
    };
    
    // 적어도 하나의 API 키가 필요
    if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
      return NextResponse.json(
        { success: false, error: "API 키가 필요합니다." },
        { status: 400 }
      );
    }
    
    const result = await updateModelMappings(apiKeys);
    
    // 업데이트된 매핑 반환
    const mappings = loadModelMappings();
    
    return NextResponse.json({
      success: result.success,
      updated: result.updated,
      errors: result.errors,
      mappings: mappings.mappings,
      availableModels: mappings.availableModels,
      lastUpdated: mappings.lastUpdated,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT: 설정 변경
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (body.autoUpdateEnabled !== undefined) {
      setAutoUpdate(body.autoUpdateEnabled, body.updateIntervalDays);
    }
    
    if (body.mapping) {
      const { provider, internalId, actualId } = body.mapping;
      if (provider && internalId && actualId) {
        setModelMapping(provider, internalId, actualId);
      }
    }
    
    const mappings = loadModelMappings();
    
    return NextResponse.json({
      success: true,
      mappings: mappings.mappings,
      autoUpdateEnabled: mappings.autoUpdateEnabled,
      updateIntervalDays: mappings.updateIntervalDays,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
