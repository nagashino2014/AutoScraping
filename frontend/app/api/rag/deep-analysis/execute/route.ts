/**
 * 심층 분석 실행 API (SSE 스트리밍)
 * 
 * POST: 선택된 이슈들에 대한 심층 분석 실행
 * - Chain-of-Thought 기반 4단계 분석
 * - 실시간 스트리밍으로 진행 상황 전달
 */

import { NextRequest } from "next/server";
import { loadSession, saveSession, getSelectedIssues, DiscoveredIssue } from "@/lib/rag/discovery-store";
import { loadRAGSettings, updateAPIUsage, MODEL_INFO, LLMModel } from "@/lib/rag/rag-settings";
import { getActualModelId, needsUpdate, updateModelMappings } from "@/lib/rag/model-mappings";
import {
  createAnalysisSession,
  addStepResult,
  addIssueResult,
  completeAnalysisSession,
  failAnalysisSession,
  loadAnalysisSession,
} from "@/lib/rag/analysis-store";
import { loadProfile, generateProfileContext, SiteProfile } from "@/lib/rag/site-profile";

export const runtime = "nodejs";
export const maxDuration = 300;

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

// ============================================================
// 타입 정의
// ============================================================

interface ExecuteRequest {
  sessionId: string;
  issueIds?: string[];  // 특정 이슈만 분석 (없으면 선택된 전체)
  profileId?: string;   // 사업장 프로파일 ID (선택)
  config?: {
    depth: "quick" | "standard" | "deep";
    includeEvidence: boolean;
    includeRecommendation: boolean;
    maxSteps?: number;
  };
}

interface AnalysisStep {
  id: string;
  name: string;
  method: string;
  promptKey: "factCheck" | "trendAnalysis" | "impactAssessment" | "responseStrategy";
}

interface StepResult {
  issueId: string;
  step: number;
  stepName: string;
  method: string;
  content: string;
  sources: string[];
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
}

// ============================================================
// 분석 단계 정의
// ============================================================

const ANALYSIS_STEPS: AnalysisStep[] = [
  { id: "1", name: "데이터 수집", method: "Retrieval", promptKey: "factCheck" },
  { id: "2", name: "초기 분석", method: "Chain-of-Thought", promptKey: "trendAnalysis" },
  { id: "3", name: "심층 추론", method: "Multi-step Reasoning", promptKey: "impactAssessment" },
  { id: "4", name: "결론 도출", method: "Synthesis", promptKey: "responseStrategy" },
];

const EXTENDED_STEPS: AnalysisStep[] = [
  ...ANALYSIS_STEPS,
  { id: "5", name: "리스크 평가", method: "Risk Assessment", promptKey: "impactAssessment" },
  { id: "6", name: "실행 계획", method: "Action Planning", promptKey: "responseStrategy" },
];

// ============================================================
// 메인 핸들러
// ============================================================

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      
      try {
        const body: ExecuteRequest = await request.json();
        const { sessionId, issueIds, profileId, config } = body;
        
        // 모델 매핑 자동 업데이트 체크 (7일 경과 시)
        if (needsUpdate()) {
          console.log("[DeepAnalysis] 모델 매핑 자동 업데이트 실행 중...");
          const apiKeys = {
            openai: process.env.OPENAI_API_KEY,
            anthropic: process.env.ANTHROPIC_API_KEY,
            google: process.env.GEMINI_API_KEY,
          };
          await updateModelMappings(apiKeys);
          console.log("[DeepAnalysis] 모델 매핑 업데이트 완료");
        }
        
        // 프로파일 로드 (선택적)
        let profile: SiteProfile | null = null;
        let profileContext: string = "";
        if (profileId) {
          profile = loadProfile(profileId);
          if (profile) {
            profileContext = generateProfileContext(profile);
            send({
              type: "profile_loaded",
              profileId: profile.id,
              profileName: profile.name,
            });
          }
        }
        
        // 세션 로드
        const session = loadSession(sessionId);
        if (!session) {
          send({ type: "error", error: "세션을 찾을 수 없습니다." });
          controller.close();
          return;
        }
        
        // 분석할 이슈 결정
        let issuesToAnalyze: DiscoveredIssue[];
        if (issueIds && issueIds.length > 0) {
          issuesToAnalyze = session.issues.filter(i => issueIds.includes(i.id));
        } else {
          issuesToAnalyze = getSelectedIssues(sessionId);
        }
        
        if (issuesToAnalyze.length === 0) {
          send({ type: "error", error: "분석할 이슈가 없습니다." });
          controller.close();
          return;
        }
        
        // 설정 로드
        const ragSettings = loadRAGSettings();
        const analysisConfig = {
          depth: config?.depth || "standard",
          includeEvidence: config?.includeEvidence ?? true,
          includeRecommendation: config?.includeRecommendation ?? true,
          maxSteps: config?.maxSteps || (config?.depth === "quick" ? 2 : config?.depth === "deep" ? 6 : 4),
        };
        
        // LLM 설정
        const llmModel = ragSettings.llm.models.analysis;
        const apiKey = getAPIKey(ragSettings, llmModel);
        
        if (!apiKey) {
          send({ type: "error", error: "LLM API 키가 설정되지 않았습니다. RAG 설정에서 API 키를 입력하세요." });
          controller.close();
          return;
        }
        
        // 분석 단계 결정
        const steps = analysisConfig.maxSteps > 4 ? EXTENDED_STEPS : ANALYSIS_STEPS;
        const activeSteps = steps.slice(0, analysisConfig.maxSteps);
        
        // 분석 세션 생성
        const analysisSession = createAnalysisSession(
          sessionId,
          `심층 분석 - ${new Date().toLocaleString("ko-KR")}`,
          analysisConfig
        );
        
        send({
          type: "started",
          sessionId,
          analysisSessionId: analysisSession.id,
          issueCount: issuesToAnalyze.length,
          stepCount: activeSteps.length,
          model: llmModel,
        });
        
        const totalSteps = issuesToAnalyze.length * activeSteps.length;
        let completedSteps = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        
        // 분석 결과 저장용
        const allResults: Record<string, StepResult[]> = {};
        
        // 검색 전략 결정
        const retrievalStrategy = ragSettings.vectorSearch?.advanced?.strategy || "hybrid";
        const useAdvancedSearch = retrievalStrategy !== "basic";
        
        // 각 이슈에 대해 분석 수행
        for (const issue of issuesToAnalyze) {
          allResults[issue.id] = [];
          
          // 관련 문서 검색 (고급 검색 파이프라인 사용)
          let contextDocs: string[] = [];
          let accumulatedContext: string[] = [];  // Multi-hop용 컨텍스트 축적
          
          try {
            // 검색 쿼리 구성 (다양한 관점)
            const searchQueries = generateSearchQueries(issue);
            
            if (useAdvancedSearch) {
              // 고급 검색 API 사용
              // 임베딩용 OpenAI API 키 (벡터 검색에 필수)
              const embeddingApiKey = process.env.OPENAI_API_KEY || "";
              
              const searchRes = await fetch(`${BACKEND_URL}/rag/advanced-search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: searchQueries[0],  // 메인 쿼리
                  n_results: ragSettings.vectorSearch?.basic?.topK || 15,
                  where: {},
                  strategy: retrievalStrategy,
                  config: {
                    enable_query_expansion: ragSettings.vectorSearch?.advanced?.enableQueryExpansion ?? false,
                    enable_hyde: ragSettings.vectorSearch?.advanced?.enableHyde ?? false,
                    enable_hybrid: ragSettings.vectorSearch?.advanced?.enableHybrid ?? true,
                    enable_reranking: ragSettings.vectorSearch?.advanced?.enableReranking ?? true,
                  },
                  llm_api_key: apiKey,  // Query Expansion, HyDE에 필요
                  embedding_api_key: embeddingApiKey,  // 벡터 검색 임베딩용 (OpenAI)
                }),
              });
              
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                contextDocs = (searchData.documents || [])
                  .slice(0, 15)
                  .map((d: any) => d.content || d);
              }
            } else {
              // 기본 검색 API 사용
              const searchRes = await fetch(`${BACKEND_URL}/rag/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: searchQueries[0],
                  n_results: ragSettings.vectorSearch?.basic?.topK || 10,
                  where: {},
                }),
              });
              
              if (searchRes.ok) {
                const searchData = await searchRes.json();
                contextDocs = (searchData.documents || [])
                  .slice(0, 10)
                  .map((d: any) => d.content || d);
              }
            }
          } catch (error) {
            console.error("Search error:", error);
            // 검색 실패 시 기존 summary 사용
            contextDocs = [issue.summary];
          }
          
          const context = contextDocs.join("\n\n---\n\n");
          
          // 각 단계 실행
          for (let i = 0; i < activeSteps.length; i++) {
            const step = activeSteps[i];
            const progress = Math.round((completedSteps / totalSteps) * 100);
            
            send({
              type: "progress",
              issueId: issue.id,
              issueTitle: issue.title,
              step: i + 1,
              stepName: step.name,
              method: step.method,
              progress,
            });
            
            // LLM 호출
            const promptTemplate = ragSettings.prompts.analysisPrompts[step.promptKey] || getDefaultPrompt(step.promptKey);
            let prompt = promptTemplate
              .replace("{issue_title}", issue.userTitle || issue.title)
              .replace("{context}", context)
              .replace("{summary}", issue.userSummary || issue.summary)
              .replace("{keywords}", issue.keywords.join(", "));
            
            // 프로파일 컨텍스트가 있으면 프롬프트에 포함
            if (profileContext) {
              prompt = `## 사업장 프로파일 (분석 관점)
${profileContext}

이 사업장 관점에서 해당 이슈의 영향과 대응 방안을 분석해 주세요.

---

${prompt}`;
            }
            
            try {
              const llmResult = await callLLM(
                llmModel,
                apiKey,
                ragSettings.prompts.systemPrompts.analysis,
                prompt,
                ragSettings.llm.parameters
              );
              
              if (llmResult) {
                const stepResult: StepResult = {
                  issueId: issue.id,
                  step: i + 1,
                  stepName: step.name,
                  method: step.method,
                  content: llmResult.content,
                  sources: extractSources(llmResult.content),
                  timestamp: new Date().toISOString(),
                  inputTokens: llmResult.inputTokens,
                  outputTokens: llmResult.outputTokens,
                };
                
                allResults[issue.id].push(stepResult);
                totalInputTokens += llmResult.inputTokens;
                totalOutputTokens += llmResult.outputTokens;
                
                // 결과 저장
                addStepResult(analysisSession.id, issue.id, {
                  stepId: step.id,
                  stepName: step.name,
                  method: step.method,
                  content: llmResult.content,
                  sources: extractSources(llmResult.content),
                  inputTokens: llmResult.inputTokens,
                  outputTokens: llmResult.outputTokens,
                  timestamp: new Date().toISOString(),
                });
                
                send({
                  type: "step_complete",
                  issueId: issue.id,
                  step: i + 1,
                  stepName: step.name,
                  method: step.method,
                  content: llmResult.content,
                  inputTokens: llmResult.inputTokens,
                  outputTokens: llmResult.outputTokens,
                });
              }
            } catch (error: any) {
              console.error(`LLM error for step ${step.name}:`, error);
              send({
                type: "step_error",
                issueId: issue.id,
                step: i + 1,
                stepName: step.name,
                error: error.message || "분석 중 오류가 발생했습니다.",
              });
            }
            
            completedSteps++;
          }
          
          // 이슈별 결과 저장
          addIssueResult(analysisSession.id, {
            issueId: issue.id,
            issueTitle: issue.userTitle || issue.title,
            steps: allResults[issue.id].map((r, idx) => ({
              stepId: activeSteps[idx]?.id || `step_${idx}`,
              stepName: r.stepName,
              method: r.method,
              content: r.content,
              sources: r.sources || [],
              inputTokens: r.inputTokens || 0,
              outputTokens: r.outputTokens || 0,
              timestamp: r.timestamp,
            })),
            summary: allResults[issue.id].slice(-1)[0]?.content?.slice(0, 500) || "",
            recommendations: [],
            completedAt: new Date().toISOString(),
          });
          
          send({
            type: "issue_complete",
            issueId: issue.id,
            issueTitle: issue.title,
            results: allResults[issue.id],
          });
        }
        
        // 비용 계산
        const modelInfo = MODEL_INFO[llmModel];
        const cost = (totalInputTokens / 1_000_000) * modelInfo.inputCost +
                     (totalOutputTokens / 1_000_000) * modelInfo.outputCost;
        
        // API 사용량 업데이트
        updateAPIUsage(modelInfo.provider, "analysis", totalInputTokens, totalOutputTokens, llmModel);
        
        // 분석 세션 완료 처리
        completeAnalysisSession(analysisSession.id, llmModel, cost);
        
        send({
          type: "complete",
          sessionId,
          analysisSessionId: analysisSession.id,
          results: allResults,
          tokenUsage: {
            input: totalInputTokens,
            output: totalOutputTokens,
            cost,
          },
          model: llmModel,
        });
        
      } catch (error: any) {
        console.error("[Deep Analysis] Error:", error);
        send({
          type: "error",
          error: error.message || "심층 분석 중 오류가 발생했습니다.",
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

function getAPIKey(settings: any, model: LLMModel): string {
  const modelInfo = MODEL_INFO[model];
  
  // 환경 변수에서 먼저 API 키 조회 (우선순위: 환경변수 > 설정파일)
  const envKeyMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
  };
  
  const envKey = envKeyMap[modelInfo.provider];
  if (envKey && process.env[envKey]) {
    return process.env[envKey] as string;
  }
  
  return settings.llm.apiKeys[modelInfo.provider] || "";
}

async function callLLM(
  model: LLMModel,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  parameters: any
): Promise<{ content: string; inputTokens: number; outputTokens: number } | null> {
  const modelInfo = MODEL_INFO[model];
  
  switch (modelInfo.provider) {
    case "openai":
      return callOpenAI(model, apiKey, systemPrompt, userPrompt, parameters);
    case "anthropic":
      return callAnthropic(model, apiKey, systemPrompt, userPrompt, parameters);
    case "google":
      return callGoogle(model, apiKey, systemPrompt, userPrompt, parameters);
    default:
      throw new Error(`Unsupported provider: ${modelInfo.provider}`);
  }
}

async function callOpenAI(
  model: LLMModel,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  parameters: any
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  // 동적 모델 매핑 (설정 파일에서 로드)
  const actualModel = getActualModelId(model, "openai");
  
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: actualModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: parameters.temperature || 0.2,
      max_tokens: parameters.maxTokens || 4096,
      top_p: parameters.topP || 0.9,
    }),
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI API error: ${res.status}`);
  }
  
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

async function callAnthropic(
  model: LLMModel,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  parameters: any
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  // 동적 모델 매핑 (설정 파일에서 로드)
  const actualModel = getActualModelId(model, "anthropic");
  
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: actualModel,
      max_tokens: parameters.maxTokens || 4096,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt },
      ],
      temperature: parameters.temperature || 0.2,
    }),
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error?.message || `Anthropic API error: ${res.status}`);
  }
  
  const data = await res.json();
  return {
    content: data.content?.[0]?.text || "",
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

async function callGoogle(
  model: LLMModel,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  parameters: any
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  // 동적 모델 매핑 (설정 파일에서 로드)
  const actualModel = getActualModelId(model, "google");
  
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${actualModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${systemPrompt}\n\n${userPrompt}` },
            ],
          },
        ],
        generationConfig: {
          temperature: parameters.temperature || 0.2,
          maxOutputTokens: parameters.maxTokens || 4096,
          topP: parameters.topP || 0.9,
        },
      }),
    }
  );
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error?.message || `Google API error: ${res.status}`);
  }
  
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  // Google API는 토큰 수를 직접 제공하지 않으므로 추정
  const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const outputTokens = Math.ceil(content.length / 4);
  
  return { content, inputTokens, outputTokens };
}

function getDefaultPrompt(promptKey: string): string {
  const defaults: Record<string, string> = {
    factCheck: `## 사실 확인 (Fact Check)

이슈: {issue_title}

참고 자료:
{context}

다음 사항을 확인하세요:
1. 정확한 법령명/고시명
2. 시행일/예고 기간
3. 주요 변경 조항
4. 적용 대상 및 범위

출처를 명시하여 작성해 주세요.`,
    
    trendAnalysis: `## 배경 분석 (Trend Analysis)

이슈: {issue_title}

참고 자료:
{context}

다음을 분석하세요:
1. 발생 배경 (국내 정책 기조)
2. 관련 국제 동향
3. 산업계 요구 및 사회적 압력
4. 기존 규제와의 연관성`,
    
    impactAssessment: `## 영향 분석 (Impact Assessment)

이슈: {issue_title}

참고 자료:
{context}

다음을 분석하세요:
1. 영향받는 산업/업종/기업 유형
2. 예상되는 비용/투자 규모
3. 시행까지 남은 준비 기간
4. 비준수 시 제재/불이익`,
    
    responseStrategy: `## 대응 전략 (Response Strategy)

이슈: {issue_title}

참고 자료:
{context}

대응 전략을 제시하세요:
1. 단기 대응 (3개월 이내)
2. 중기 대응 (1년 이내)
3. 장기 대응 (1년 이상)

실행 가능한 구체적 조치를 제시해 주세요.`,
  };
  
  return defaults[promptKey] || defaults.factCheck;
}

/**
 * 이슈에 대한 다양한 검색 쿼리 생성
 */
function generateSearchQueries(issue: { 
  title: string; 
  keywords: string[]; 
  userTitle?: string;
  userSummary?: string;
}): string[] {
  const mainTitle = issue.userTitle || issue.title;
  const keywords = issue.keywords.slice(0, 5);
  
  const queries = [
    // 메인 쿼리: 제목 + 핵심 키워드
    `${mainTitle} ${keywords.join(" ")}`,
  ];
  
  // 법령/규제 관점 쿼리
  if (keywords.some(k => k.includes("법") || k.includes("규제") || k.includes("기준"))) {
    queries.push(`${keywords[0]} 관련 법령 시행일 적용범위`);
  }
  
  // 산업 영향 관점 쿼리
  queries.push(`${keywords[0]} 산업 영향 비용 대응`);
  
  // 동향 관점 쿼리
  queries.push(`${keywords[0]} 정책 동향 변화`);
  
  return queries;
}

/**
 * Multi-hop RAG: 단계별 추가 검색 쿼리 생성
 */
function generateFollowUpQueries(
  stepName: string,
  previousContent: string,
  issue: { title: string; keywords: string[] }
): string[] {
  const queries: string[] = [];
  
  // 이전 분석에서 언급된 법령/기관명 추출
  const legalTerms = previousContent.match(/「([^」]+)」|『([^』]+)』/g) || [];
  const orgTerms = previousContent.match(/[가-힣]{2,}부(?:\s|$)|[가-힣]{2,}청(?:\s|$)|[가-힣]{2,}원(?:\s|$)/g) || [];
  
  // 단계별 후속 쿼리
  switch (stepName) {
    case "데이터 수집":
      // 사실 확인 후 배경 정보 검색
      if (legalTerms.length > 0) {
        queries.push(`${legalTerms[0]} 제정 배경 목적`);
      }
      break;
      
    case "초기 분석":
      // 배경 분석 후 영향 정보 검색
      queries.push(`${issue.keywords[0]} 산업 영향 사례`);
      break;
      
    case "심층 추론":
      // 영향 분석 후 대응 사례 검색
      queries.push(`${issue.keywords[0]} 대응 방안 모범사례`);
      break;
  }
  
  return queries;
}

function extractSources(content: string): string[] {
  const sources: string[] = [];
  
  // 출처 패턴 매칭 (예: [출처], 출처:, (출처), 참고: 등)
  const patterns = [
    /\[출처[:\s]*([^\]]+)\]/g,
    /출처[:\s]+([^\n]+)/g,
    /참고[:\s]+([^\n]+)/g,
    /\(([^)]*법[^)]*)\)/g,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const source = match[1].trim();
      if (source && source.length < 200 && !sources.includes(source)) {
        sources.push(source);
      }
    }
  }
  
  return sources.slice(0, 10);
}
