/**
 * 임베딩 통계 API
 * 
 * GET /api/processing/embedding/stats - 통계 조회
 * POST /api/processing/embedding/stats - 통계 업데이트 (임베딩 완료 시)
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STATS_FILE = path.join(DATA_DIR, "embedding-stats.json");

// 임베딩 작업 기록 타입
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

// 통계 데이터 타입
interface EmbeddingStats {
  total_embeddings: number;        // 누적 임베딩 성공 횟수
  total_failed: number;            // 누적 실패 횟수
  total_tokens: number;            // 누적 토큰 사용량
  total_cost: number;              // 누적 비용
  records: EmbeddingRecord[];      // 작업 기록 배열
  last_updated: string;
}

// 기본 통계 데이터
const DEFAULT_STATS: EmbeddingStats = {
  total_embeddings: 0,
  total_failed: 0,
  total_tokens: 0,
  total_cost: 0,
  records: [],
  last_updated: new Date().toISOString(),
};

// 통계 파일 읽기
function loadStats(): EmbeddingStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = fs.readFileSync(STATS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading embedding stats:", error);
  }
  return { ...DEFAULT_STATS };
}

// 통계 파일 저장
function saveStats(stats: EmbeddingStats): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving embedding stats:", error);
    throw error;
  }
}

// GET: 통계 조회
export async function GET() {
  try {
    const stats = loadStats();
    
    // 기간별 비용 집계
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    let weekCost = 0;
    let monthCost = 0;
    const modelCosts: Record<string, number> = {};
    
    for (const record of stats.records) {
      const recordDate = new Date(record.timestamp);
      
      if (recordDate >= weekAgo) {
        weekCost += record.estimated_cost;
      }
      if (recordDate >= monthAgo) {
        monthCost += record.estimated_cost;
      }
      
      // 모델별 비용
      if (!modelCosts[record.model]) {
        modelCosts[record.model] = 0;
      }
      modelCosts[record.model] += record.estimated_cost;
    }
    
    return NextResponse.json({
      success: true,
      stats: {
        total_embeddings: stats.total_embeddings,
        total_failed: stats.total_failed,
        total_tokens: stats.total_tokens,
        total_cost: stats.total_cost,
        week_cost: weekCost,
        month_cost: monthCost,
        model_costs: modelCosts,
        records_count: stats.records.length,
        last_updated: stats.last_updated,
      }
    });
  } catch (error) {
    console.error("Error getting embedding stats:", error);
    return NextResponse.json(
      { success: false, error: "통계 조회 실패" },
      { status: 500 }
    );
  }
}

// POST: 통계 업데이트
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      model,
      chunks_processed = 0,
      chunks_failed = 0,
      tokens_used = 0,
      estimated_cost = 0,
      duration_ms = 0,
    } = body;
    
    const stats = loadStats();
    
    // 새 기록 추가
    const newRecord: EmbeddingRecord = {
      id: `emb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      model: model || "unknown",
      chunks_processed,
      chunks_failed,
      tokens_used,
      estimated_cost,
      duration_ms,
    };
    
    stats.records.push(newRecord);
    
    // 누적 통계 업데이트
    stats.total_embeddings += chunks_processed;
    stats.total_failed += chunks_failed;
    stats.total_tokens += tokens_used;
    stats.total_cost += estimated_cost;
    stats.last_updated = new Date().toISOString();
    
    // 저장
    saveStats(stats);
    
    return NextResponse.json({
      success: true,
      record: newRecord,
      stats: {
        total_embeddings: stats.total_embeddings,
        total_failed: stats.total_failed,
        total_tokens: stats.total_tokens,
        total_cost: stats.total_cost,
      }
    });
  } catch (error) {
    console.error("Error updating embedding stats:", error);
    return NextResponse.json(
      { success: false, error: "통계 업데이트 실패" },
      { status: 500 }
    );
  }
}
