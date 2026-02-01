/**
 * API 사용량 조회 API
 * GET: 현재 월 사용량 조회
 */

import { NextRequest, NextResponse } from "next/server";
import { loadAPIUsage, loadRAGSettings } from "@/lib/rag/rag-settings";

export async function GET(req: NextRequest) {
  try {
    const usage = loadAPIUsage();
    const settings = loadRAGSettings();
    
    // 예산 대비 사용률 계산
    const budget = settings.llm.costManagement.monthlyBudget;
    const usagePercentage = budget > 0 ? (usage.totalCost / budget) * 100 : 0;
    const alertThreshold = settings.llm.costManagement.budgetAlertThreshold * 100;
    
    return NextResponse.json({
      ...usage,
      budget,
      usagePercentage: Math.round(usagePercentage * 100) / 100,
      alertThreshold,
      isOverBudget: usagePercentage >= 100,
      isNearBudget: usagePercentage >= alertThreshold,
    });
  } catch (error: any) {
    console.error("Failed to load API usage:", error);
    return NextResponse.json(
      { error: error.message || "사용량 조회에 실패했습니다." },
      { status: 500 }
    );
  }
}
