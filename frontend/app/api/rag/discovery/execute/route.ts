/**
 * 이슈 발굴 실행 API (SSE 스트리밍)
 * 
 * POST: 이슈 발굴 세션 생성 및 실행
 */

import { NextRequest } from "next/server";
import {
  createSession,
  saveSession,
  updateSessionProgress,
  addIssuesToSession,
  completeSession,
  failSession,
  loadSession,
  DiscoverySession,
  DEFAULT_DISCOVERY_CONFIG,
} from "@/lib/rag/discovery-store";
import { loadRAGSettings } from "@/lib/rag/rag-settings";
import { loadProfile, generateProfileContext, SiteProfile } from "@/lib/rag/site-profile";
import { generateOptionsContext } from "@/lib/rag/analysis-options";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

interface ExecuteRequest {
  name?: string;
  profileId?: string;  // 사업장 프로파일 ID (선택)
  analysisOptions?: Record<string, string[]>;  // 분석 옵션 (카테고리별 선택된 옵션 ID)
  filter?: {
    dateRange?: { start: string; end: string };
    orgs?: string[];
    boards?: string[];
    chunkTypes?: string[];
  };
  config?: {
    numIssues?: number;
    numClusters?: number;
    minClusterSize?: number;
    scoreWeights?: Record<string, number>;
    scoringCriteria?: Array<{ id: string; label: string; description: string; weight: number }>;
  };
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  // SSE 스트림 생성
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      
      let session: DiscoverySession | null = null;
      
      try {
        // 요청 파싱
        const body: ExecuteRequest = await request.json();
        
        // 프로파일 로드 (선택적)
        let profile: SiteProfile | null = null;
        let profileContext: string = "";
        if (body.profileId) {
          profile = loadProfile(body.profileId);
          if (profile) {
            profileContext = generateProfileContext(profile);
            send({
              type: "profile_loaded",
              profileName: profile.name,
            });
          }
        }
        
        // 분석 옵션 컨텍스트 생성
        let optionsContext: string = "";
        if (body.analysisOptions) {
          optionsContext = generateOptionsContext(body.analysisOptions);
        }
        
        // 세션 생성
        const sessionName = body.name || 
          (profile ? `${profile.name} - 이슈 발굴` : `이슈 발굴 ${new Date().toLocaleString("ko-KR")}`);
        const config = {
          ...DEFAULT_DISCOVERY_CONFIG,
          ...body.config,
          scoreWeights: {
            ...DEFAULT_DISCOVERY_CONFIG.scoreWeights,
            ...body.config?.scoreWeights,
          },
        };
        
        // ChromaDB where 절 생성
        const whereClause = buildWhereClause(body.filter);
        
        session = createSession(sessionName, body.filter || {}, config);
        
        send({
          type: "session_created",
          sessionId: session.id,
          name: session.name,
        });
        
        // Step 1: 필터링
        send({ type: "progress", step: "필터링 중...", progress: 5 });
        updateSessionProgress(session.id, 5, "필터링 중...", "filtering");
        
        // Step 2: 클러스터링 및 이슈 발굴 (백엔드 호출)
        send({ type: "progress", step: "클러스터링 수행 중...", progress: 10 });
        updateSessionProgress(session.id, 10, "클러스터링 수행 중...", "discovering");
        
        const discoveryRes = await fetch(`${BACKEND_URL}/rag/discover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filter: whereClause,
            config: {
              numIssues: config.numIssues,
              numClusters: config.numClusters,
              minClusterSize: config.minClusterSize,
              scoreWeights: config.scoreWeights,
            },
            limit: 2000,
          }),
        });
        
        if (!discoveryRes.ok) {
          const errorData = await discoveryRes.json().catch(() => ({}));
          throw new Error(errorData.detail || errorData.error || `Backend error: ${discoveryRes.status}`);
        }
        
        const discoveryResult = await discoveryRes.json();
        
        if (!discoveryResult.success) {
          throw new Error(discoveryResult.error || "이슈 발굴에 실패했습니다.");
        }
        
        send({ type: "progress", step: "이슈 후보 생성됨", progress: 50 });
        
        // Step 3: LLM 기반 요약 및 평가 (선택적)
        const ragSettings = loadRAGSettings();
        
        // 환경 변수에서 API 키 자동 로드 (우선순위: 환경변수 > 설정파일)
        const llmApiKey = process.env.OPENAI_API_KEY || ragSettings.llm.apiKeys.openai;
        const llmModel = ragSettings.llm.models.discovery;
        
        let issues = discoveryResult.issues;
        let tokenUsage = { input: 0, output: 0, cost: 0 };
        
        if (llmApiKey && issues.length > 0) {
          send({ type: "progress", step: "LLM 분석 중...", progress: 55 });
          
          // 각 이슈에 대해 LLM 요약
          for (let i = 0; i < Math.min(issues.length, config.numIssues); i++) {
            const issue = issues[i];
            const progress = 55 + Math.floor((i / issues.length) * 40);
            
            send({
              type: "progress",
              step: `이슈 ${i + 1}/${issues.length} LLM 분석 중...`,
              progress,
            });
            
            try {
              const llmResult = await summarizeWithLLM(issue, llmApiKey, llmModel, profileContext, optionsContext, body.config?.scoringCriteria);
              if (llmResult) {
                issues[i] = {
                  ...issue,
                  title: llmResult.title || issue.title,
                  summary: llmResult.summary || issue.summary,
                  score: {
                    ...issue.score,
                    ...llmResult.scores,
                    total: calculateTotalScore(llmResult.scores || {}, config.scoreWeights),
                  },
                };
                tokenUsage.input += llmResult.inputTokens || 0;
                tokenUsage.output += llmResult.outputTokens || 0;
              }
            } catch (llmError) {
              console.error(`LLM error for issue ${i}:`, llmError);
              // LLM 실패해도 계속 진행
            }
          }
          
          // 점수순 재정렬
          issues.sort((a: any, b: any) => (b.score?.total || 0) - (a.score?.total || 0));
        }
        
        send({ type: "progress", step: "결과 저장 중...", progress: 95 });
        
        // 세션에 이슈 추가
        const savedIssues = addIssuesToSession(session.id, issues.map((issue: any) => ({
          title: issue.title,
          summary: issue.summary,
          keywords: issue.keywords || [],
          clusterId: issue.clusterId,
          clusterSize: issue.clusterSize,
          representativeChunkIds: issue.representativeChunkIds || [],
          score: issue.score,
          status: "discovered" as const,
          sources: issue.sources || [],
        })));
        
        // 세션 완료
        const updatedSession = loadSession(session.id);
        if (updatedSession) {
          updatedSession.filteredChunkCount = discoveryResult.filteredChunkCount || 0;
          saveSession(updatedSession);
        }
        
        // 비용 계산
        tokenUsage.cost = calculateCost(tokenUsage.input, tokenUsage.output, llmModel);
        completeSession(session.id, tokenUsage, llmModel);
        
        send({
          type: "complete",
          sessionId: session.id,
          issues: savedIssues,
          stats: discoveryResult.stats,
          tokenUsage,
        });
        
      } catch (error: any) {
        console.error("[Discovery] Error:", error);
        
        if (session) {
          failSession(session.id, error.message);
        }
        
        send({
          type: "error",
          error: error.message || "이슈 발굴 중 오류가 발생했습니다.",
          sessionId: session?.id,
        });
      } finally {
        controller.close();
      }
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// ============================================================
// 헬퍼 함수
// ============================================================

function buildWhereClause(filter?: ExecuteRequest["filter"]): any {
  if (!filter) return undefined;
  
  const conditions: any[] = [];
  
  if (filter.orgs && filter.orgs.length > 0) {
    if (filter.orgs.length === 1) {
      conditions.push({ org_name: filter.orgs[0] });
    } else {
      conditions.push({ org_name: { "$in": filter.orgs } });
    }
  }
  
  if (filter.boards && filter.boards.length > 0) {
    if (filter.boards.length === 1) {
      conditions.push({ board_name: filter.boards[0] });
    } else {
      conditions.push({ board_name: { "$in": filter.boards } });
    }
  }
  
  if (filter.chunkTypes && filter.chunkTypes.length > 0) {
    if (filter.chunkTypes.length === 1) {
      conditions.push({ chunk_type: filter.chunkTypes[0] });
    } else {
      conditions.push({ chunk_type: { "$in": filter.chunkTypes } });
    }
  }
  
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { "$and": conditions };
}

async function summarizeWithLLM(
  issue: any,
  apiKey: string,
  model: string,
  profileContext?: string,
  optionsContext?: string,
  scoringCriteria?: Array<{ id: string; label: string; description: string; weight: number }>
): Promise<{ title: string; summary: string; scores: any; inputTokens: number; outputTokens: number } | null> {
  // 프로파일 컨텍스트가 있으면 포함
  const profileSection = profileContext ? `
## 사업장 프로파일 (분석 관점)
${profileContext}

이 사업장 관점에서 해당 이슈의 영향도와 대응 필요성을 평가해 주세요.
` : "";

  // 분석 옵션 컨텍스트가 있으면 포함
  const optionsSection = optionsContext ? `
${optionsContext}
` : "";

  // 동적 평가 기준 (scoringCriteria가 있으면 사용, 없으면 기본 4개 사용)
  let criteriaListText: string;
  let scoresJsonTemplate: string;
  if (scoringCriteria && scoringCriteria.length > 0) {
    criteriaListText = scoringCriteria.map(c => `   - ${c.id}: ${c.label} (${c.description})`).join("\n");
    const scoresObj: Record<string, number> = {};
    scoringCriteria.forEach(c => { scoresObj[c.id] = 0.0; });
    scoresJsonTemplate = JSON.stringify(scoresObj);
  } else {
    criteriaListText = `   - legalMandatory: 법적 강제성
   - novelty: 신규성
   - impact: 파급력
   - international: 국제 동향`;
    scoresJsonTemplate = `{"legalMandatory": 0.0, "novelty": 0.0, "impact": 0.0, "international": 0.0}`;
  }

  const prompt = `다음 정책/규제 클러스터를 분석해 주세요.
${profileSection}${optionsSection}
## 키워드
${(issue.keywords || []).slice(0, 10).join(", ")}

## 대표 내용
${issue.summary || ""}

## 출처
${(issue.sources || []).map((s: any) => `- ${s.orgName} / ${s.boardName}`).join("\n")}

## 요청
1. 이슈 제목 (20자 이내, 핵심만)
2. 요약 (2-3문장)${profileContext ? '\n3. 사업장 영향 분석 (1문장)' : ''}
3. 중요도 점수 (각 0.0~1.0):
${criteriaListText}

JSON으로 응답:
{"title": "...", "summary": "...", ${profileContext ? '"siteImpact": "...",' : ''}"scores": ${scoresJsonTemplate}}`;

  try {
    const modelName = model.includes("5-mini") ? "gpt-4o-mini" : "gpt-4o";
    
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "환경/에너지 정책 분석 전문가입니다. JSON 형식으로만 응답합니다." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
      }),
    });
    
    if (!res.ok) return null;
    
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    // JSON 파싱
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: parsed.title,
        summary: parsed.summary,
        scores: parsed.scores,
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      };
    }
  } catch (error) {
    console.error("LLM summarization error:", error);
  }
  
  return null;
}

function calculateTotalScore(scores: any, weights: any): number {
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += (scores[key] || 0) * (weight as number);
  }
  return Math.min(1.0, Math.max(0.0, total));
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  // 모델별 가격 ($/1M tokens)
  const prices: Record<string, { input: number; output: number }> = {
    "gpt-5-mini": { input: 0.25, output: 2.0 },
    "gpt-5.2": { input: 1.75, output: 14.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4o": { input: 2.5, output: 10.0 },
  };
  
  const price = prices[model] || prices["gpt-4o-mini"];
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}
