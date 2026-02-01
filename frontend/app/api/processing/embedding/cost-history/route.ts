/**
 * 임베딩 비용 추이 API
 * 
 * GET /api/processing/embedding/cost-history?period=week|month|quarter|year
 * - 기간별 비용 추이 데이터 반환 (그래프용)
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "embedding-stats.json");

interface EmbeddingRecord {
  id: string;
  timestamp: string;
  model: string;
  chunks_processed: number;
  chunks_failed: number;
  tokens_used: number;
  estimated_cost: number;
  duration_ms: number;
}

interface EmbeddingStats {
  total_embeddings: number;
  total_failed: number;
  total_tokens: number;
  total_cost: number;
  records: EmbeddingRecord[];
  last_updated: string;
}

// 날짜를 기간 키로 변환
function getDateKey(date: Date, period: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const week = getWeekNumber(date);
  const quarter = Math.ceil((date.getMonth() + 1) / 3);
  
  switch (period) {
    case "week":
      return `${month}/${day}`;  // 일별 (최근 7일)
    case "month":
      return `${month}/${day}`;  // 일별 (최근 30일)
    case "quarter":
      return `${year}-${month}`;  // 월별 (최근 3개월)
    case "year":
      return `${year}-${month}`;  // 월별 (최근 12개월)
    default:
      return `${month}/${day}`;
  }
}

// 주차 계산
function getWeekNumber(date: Date): number {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

// 기간에 따른 시작 날짜 계산
function getStartDate(period: string): Date {
  const now = new Date();
  switch (period) {
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "quarter":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case "year":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

// 기간 내 모든 날짜 키 생성 (빈 데이터 포함)
function generateDateKeys(startDate: Date, endDate: Date, period: string): string[] {
  const keys: string[] = [];
  const current = new Date(startDate);
  
  if (period === "week" || period === "month") {
    // 일별
    while (current <= endDate) {
      keys.push(getDateKey(current, period));
      current.setDate(current.getDate() + 1);
    }
  } else {
    // 월별
    while (current <= endDate) {
      const key = getDateKey(current, period);
      if (!keys.includes(key)) {
        keys.push(key);
      }
      current.setMonth(current.getMonth() + 1);
    }
  }
  
  return keys;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "week";
    
    // 통계 파일 읽기
    let stats: EmbeddingStats = {
      total_embeddings: 0,
      total_failed: 0,
      total_tokens: 0,
      total_cost: 0,
      records: [],
      last_updated: new Date().toISOString(),
    };
    
    if (fs.existsSync(STATS_FILE)) {
      const data = fs.readFileSync(STATS_FILE, "utf-8");
      stats = JSON.parse(data);
    }
    
    const startDate = getStartDate(period);
    const endDate = new Date();
    
    // 기간별 비용 집계
    const costByDate: Record<string, number> = {};
    const tokensByDate: Record<string, number> = {};
    const countByDate: Record<string, number> = {};
    const modelCosts: Record<string, Record<string, number>> = {};
    
    // 기간 내 기록 필터링 및 집계
    const filteredRecords = stats.records.filter(record => {
      const recordDate = new Date(record.timestamp);
      return recordDate >= startDate && recordDate <= endDate;
    });
    
    for (const record of filteredRecords) {
      const recordDate = new Date(record.timestamp);
      const dateKey = getDateKey(recordDate, period);
      
      if (!costByDate[dateKey]) {
        costByDate[dateKey] = 0;
        tokensByDate[dateKey] = 0;
        countByDate[dateKey] = 0;
      }
      
      costByDate[dateKey] += record.estimated_cost;
      tokensByDate[dateKey] += record.tokens_used;
      countByDate[dateKey] += record.chunks_processed;
      
      // 모델별 집계
      if (!modelCosts[record.model]) {
        modelCosts[record.model] = {};
      }
      if (!modelCosts[record.model][dateKey]) {
        modelCosts[record.model][dateKey] = 0;
      }
      modelCosts[record.model][dateKey] += record.estimated_cost;
    }
    
    // 빈 날짜 포함하여 차트 데이터 생성
    const allDateKeys = generateDateKeys(startDate, endDate, period);
    const chartData = allDateKeys.map(dateKey => ({
      date: dateKey,
      cost: costByDate[dateKey] || 0,
      tokens: tokensByDate[dateKey] || 0,
      count: countByDate[dateKey] || 0,
    }));
    
    // 누적 비용 계산 (추세선용)
    let cumulativeCost = 0;
    const chartDataWithCumulative = chartData.map(item => {
      cumulativeCost += item.cost;
      return {
        ...item,
        cumulativeCost,
      };
    });
    
    // 모델별 총 비용 계산
    const modelTotalCosts: Record<string, { total: number; period: number }> = {};
    for (const model of Object.keys(modelCosts)) {
      const periodTotal = Object.values(modelCosts[model]).reduce((sum, cost) => sum + cost, 0);
      const allTimeTotal = stats.records
        .filter(r => r.model === model)
        .reduce((sum, r) => sum + r.estimated_cost, 0);
      
      modelTotalCosts[model] = {
        total: allTimeTotal,
        period: periodTotal,
      };
    }
    
    // 기간 내 총계
    const periodTotal = filteredRecords.reduce((sum, r) => sum + r.estimated_cost, 0);
    const periodTokens = filteredRecords.reduce((sum, r) => sum + r.tokens_used, 0);
    const periodCount = filteredRecords.reduce((sum, r) => sum + r.chunks_processed, 0);
    
    return NextResponse.json({
      success: true,
      period,
      chartData: chartDataWithCumulative,
      summary: {
        period_cost: periodTotal,
        period_tokens: periodTokens,
        period_count: periodCount,
        total_cost: stats.total_cost,
        total_tokens: stats.total_tokens,
        total_embeddings: stats.total_embeddings,
        model_costs: modelTotalCosts,
        records_in_period: filteredRecords.length,
      },
    });
    
  } catch (error) {
    console.error("Error getting cost history:", error);
    return NextResponse.json(
      { success: false, error: "비용 추이 조회 실패" },
      { status: 500 }
    );
  }
}
