/**
 * 벡터 검색 API
 * 
 * POST /api/processing/vectorize/search
 * - 쿼리 텍스트를 임베딩하고 벡터 DB에서 유사 청크 검색
 */

import { NextRequest, NextResponse } from "next/server";
import { loadEmbeddingSettings } from "@/lib/chunking/embedding";

export const runtime = "nodejs";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";

// ============================================================================
// 쿼리 임베딩 생성
// ============================================================================

async function getQueryEmbedding(
  query: string,
  model: string,
  apiKey?: string
): Promise<number[]> {
  const isOpenAI = model.startsWith("openai");

  if (isOpenAI) {
    if (!apiKey) {
      throw new Error("OpenAI API 키가 필요합니다.");
    }

    const modelName = model === "openai-large" 
      ? "text-embedding-3-large" 
      : "text-embedding-3-small";

    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: query,
        model: modelName,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenAI API error: ${res.status}`);
    }

    const data = await res.json();
    return data.data[0].embedding;

  } else {
    // HuggingFace 모델 - 백엔드 사용
    const res = await fetch(`${BACKEND_URL}/embedding/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: [query],
        model: model,
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.detail || `Backend error: ${res.status}`);
    }

    const data = await res.json();
    return data.embeddings[0];
  }
}

// ============================================================================
// POST: 벡터 검색
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      query,
      api_key,
      n_results = 5,
      collection_name = "document_embeddings",
      filter,
    } = body as {
      query: string;
      api_key?: string;
      n_results?: number;
      collection_name?: string;
      filter?: Record<string, unknown>;
    };

    if (!query?.trim()) {
      return NextResponse.json(
        { success: false, error: "검색어를 입력하세요." },
        { status: 400 }
      );
    }

    // 현재 임베딩 설정 로드
    const settings = loadEmbeddingSettings();
    const isOpenAI = settings.model.startsWith("openai");

    // OpenAI 모델인 경우 API 키 필요
    if (isOpenAI && !api_key) {
      return NextResponse.json(
        { success: false, error: "OpenAI API 키가 필요합니다." },
        { status: 400 }
      );
    }

    // 쿼리 임베딩 생성
    const queryEmbedding = await getQueryEmbedding(query, settings.model, api_key);

    // 벡터 DB 검색
    const searchRes = await fetch(`${BACKEND_URL}/vectordb/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        n_results,
        collection_name,
        filter,
      }),
    });

    if (!searchRes.ok) {
      const errorData = await searchRes.json().catch(() => ({}));
      throw new Error(errorData.detail || `Search error: ${searchRes.status}`);
    }

    const searchResult = await searchRes.json();

    return NextResponse.json({
      success: true,
      query,
      model: settings.model,
      results: searchResult.results,
      count: searchResult.count,
    });

  } catch (error) {
    console.error("Error searching vectors:", error);
    const errorMessage = error instanceof Error ? error.message : "검색 중 오류가 발생했습니다.";
    
    if (errorMessage.includes("ECONNREFUSED") || errorMessage.includes("fetch failed")) {
      return NextResponse.json(
        { success: false, error: "백엔드 서버에 연결할 수 없습니다." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
