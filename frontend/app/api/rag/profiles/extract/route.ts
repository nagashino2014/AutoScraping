/**
 * 사업장 프로파일 LLM 정보 추출 API
 * 
 * POST: 벡터DB에서 관련 청크를 검색하고 LLM으로 정보 추출
 */

import { NextRequest, NextResponse } from "next/server";
import { loadProfile, saveProfile, SiteProfile } from "@/lib/rag/site-profile";
import { 
  extractWithLLM, 
  mapExtractedDataToProfile,
  extractAllTabs,
} from "@/lib/rag/profile-extraction";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      profileId, 
      tabId, 
      mode = "single",  // "single" | "all"
      targetTabs,       // mode가 "all"일 때 추출할 탭 목록
    } = body;
    
    if (!profileId) {
      return NextResponse.json(
        { success: false, error: "프로파일 ID가 필요합니다." },
        { status: 400 }
      );
    }
    
    // API 키 확인
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "OpenAI API 키가 설정되지 않았습니다." },
        { status: 500 }
      );
    }
    
    // 프로파일 로드
    const profile = loadProfile(profileId);
    if (!profile) {
      return NextResponse.json(
        { success: false, error: "프로파일을 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    
    // 벡터DB에서 관련 청크 검색
    const contextChunks = await searchProfileChunks(profileId, tabId || "overview");
    
    if (contextChunks.length === 0) {
      return NextResponse.json({
        success: false,
        error: "추출할 문서가 없습니다. 먼저 문서를 업로드하세요.",
      });
    }
    
    // 컨텍스트 결합
    const context = contextChunks.map(c => c.content).join("\n\n---\n\n");
    
    if (mode === "all") {
      // 전체 탭 추출
      const { results, summary } = await extractAllTabs(context, apiKey, targetTabs);
      
      // 프로파일 업데이트
      let updatedProfile = { ...profile };
      for (const [tab, result] of Object.entries(results)) {
        if (result.success && result.data) {
          const updates = mapExtractedDataToProfile(updatedProfile, tab, result.data);
          updatedProfile = { ...updatedProfile, ...updates };
        }
      }
      
      // 마지막 분석 시간 기록
      updatedProfile.lastAnalyzedAt = new Date().toISOString();
      saveProfile(updatedProfile as SiteProfile);
      
      return NextResponse.json({
        success: summary.success,
        mode: "all",
        extractedTabs: summary.extractedTabs,
        failedTabs: summary.failedTabs,
        totalTokensUsed: summary.totalTokensUsed,
        errors: summary.errors,
        profile: updatedProfile,
      });
      
    } else {
      // 단일 탭 추출
      if (!tabId) {
        return NextResponse.json(
          { success: false, error: "탭 ID가 필요합니다." },
          { status: 400 }
        );
      }
      
      const result = await extractWithLLM(context, tabId, apiKey);
      
      if (!result.success) {
        return NextResponse.json({
          success: false,
          error: result.error,
        });
      }
      
      // 프로파일 업데이트
      const updates = mapExtractedDataToProfile(profile, tabId, result.data);
      const updatedProfile = { ...profile, ...updates };
      updatedProfile.lastAnalyzedAt = new Date().toISOString();
      saveProfile(updatedProfile as SiteProfile);
      
      return NextResponse.json({
        success: true,
        mode: "single",
        tabId,
        extractedData: result.data,
        tokensUsed: result.tokensUsed,
        profile: updatedProfile,
      });
    }
    
  } catch (error: any) {
    console.error("[ProfileExtract] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// 프로파일 벡터DB에서 관련 청크 검색
async function searchProfileChunks(
  profileId: string,
  tabId: string
): Promise<{ content: string; metadata: any }[]> {
  try {
    // 탭별 검색 쿼리 생성
    const queryMap: Record<string, string> = {
      overview: "사업장 기본정보 현황 개요",
      emissionFacilities: "배출시설 대기 수질 시설코드",
      preventionFacilities: "방지시설 처리시설 집진 탈황 탈질",
      stacks: "굴뚝 배출구 높이 TMS",
      processes: "공정 제조 생산 투입 산출",
      chemicals: "화학물질 유해물질 유독물질 CAS",
      airPollutants: "대기오염물질 NOx SOx PM",
      ghgEmissions: "온실가스 이산화탄소 배출권",
      permits: "허가 인허가 통합환경허가",
      batStatus: "BAT 최적가용기법 AEL",
      tmsPoints: "TMS 자동측정 굴뚝측정",
      selfMeasurements: "자가측정 측정계획 측정주기",
      regulations: "법령 규제 환경법 의무사항",
    };
    
    const query = queryMap[tabId] || "통합환경관리계획서";
    
    // 임베딩 생성
    const embeddingRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: query,
      }),
    });
    
    if (!embeddingRes.ok) {
      console.error("Embedding API error:", embeddingRes.status);
      return [];
    }
    
    const embeddingData = await embeddingRes.json();
    const queryEmbedding = embeddingData.data[0].embedding;
    
    // 벡터 검색
    const searchRes = await fetch(`${BACKEND_URL}/profile-vectordb/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        n_results: 15,
        profile_id: profileId,
      }),
    });
    
    if (!searchRes.ok) {
      console.error("VectorDB search error:", searchRes.status);
      return [];
    }
    
    const searchData = await searchRes.json();
    
    if (!searchData.success || !searchData.results) {
      return [];
    }
    
    return searchData.results.map((r: any) => ({
      content: r.document,
      metadata: r.metadata,
    }));
    
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}
