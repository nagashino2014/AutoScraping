/**
 * 임베딩 설정 API
 * 
 * GET /api/processing/embedding/settings - 설정 조회
 * PUT /api/processing/embedding/settings - 설정 업데이트
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadEmbeddingSettings,
  saveEmbeddingSettings,
  getEmbeddingStats,
  getModelConfig,
  EmbeddingSettings,
  EmbeddingModel,
} from "@/lib/chunking/embedding";

export const runtime = "nodejs";

// ============================================================================
// GET: 설정 조회
// ============================================================================

export async function GET() {
  try {
    const settings = loadEmbeddingSettings();
    const stats = getEmbeddingStats();
    
    // 모델별 정보 추가
    const modelInfo = getModelConfig(settings.model);

    return NextResponse.json({
      success: true,
      settings,
      stats,
      modelInfo: {
        dimensions: modelInfo.dimensions,
        maxTokens: modelInfo.maxTokens,
        costPer1M: modelInfo.costPer1M,
      },
    });
    
  } catch (error) {
    console.error("Error getting embedding settings:", error);
    return NextResponse.json(
      { success: false, error: "설정을 불러오는데 실패했습니다." },
      { status: 500 }
    );
  }
}

// ============================================================================
// PUT: 설정 업데이트
// ============================================================================

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { model, batchSize, concurrent, autoRetry } = body as Partial<EmbeddingSettings>;

    // 현재 설정 로드
    const currentSettings = loadEmbeddingSettings();

    // 새 설정 병합
    const newSettings: EmbeddingSettings = {
      ...currentSettings,
      ...(model !== undefined && { model: model as EmbeddingModel }),
      ...(batchSize !== undefined && { batchSize: Math.max(10, Math.min(500, batchSize)) }),
      ...(concurrent !== undefined && { concurrent: Math.max(1, Math.min(10, concurrent)) }),
      ...(autoRetry !== undefined && { autoRetry }),
    };

    // 설정 저장
    const savedSettings = saveEmbeddingSettings(newSettings);

    // 모델 정보 추가
    const modelInfo = getModelConfig(savedSettings.model);

    return NextResponse.json({
      success: true,
      settings: savedSettings,
      modelInfo: {
        dimensions: modelInfo.dimensions,
        maxTokens: modelInfo.maxTokens,
        costPer1M: modelInfo.costPer1M,
      },
    });

  } catch (error) {
    console.error("Error updating embedding settings:", error);
    return NextResponse.json(
      { success: false, error: "설정 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
