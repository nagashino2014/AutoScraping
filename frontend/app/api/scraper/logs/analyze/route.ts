import { NextResponse } from "next/server";
import { llmChatJson } from "@/lib/llm/client";
import { getScrapeLogDetail, classifyErrorType, ERROR_TYPE_LABELS } from "@/lib/scraper/scraper-db";
import { readScraperTargets } from "@/lib/scraper/targets-store";

interface AnalysisResult {
  summary: string;
  possible_causes: string[];
  suggested_actions: string[];
  confidence: "high" | "medium" | "low";
  additional_notes?: string;
}

/**
 * POST /api/scraper/logs/analyze
 * 
 * Body:
 * - logId: 분석할 로그 ID
 * - provider: "openai" | "gemini" | "anthropic"
 * - model?: 수동 모델 지정 시 사용
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { logId, provider = "openai", model } = body;
    
    if (!logId) {
      return NextResponse.json({ error: "logId is required" }, { status: 400 });
    }
    
    // 로그 상세 조회
    const log = await getScrapeLogDetail(logId);
    if (!log) {
      return NextResponse.json({ error: "Log not found" }, { status: 404 });
    }
    
    // 보드 설정 조회
    const targets = await readScraperTargets();
    let boardConfig: any = null;
    let orgConfig: any = null;
    
    const boardMap = new Map(targets.boards.map((b) => [b.board_id, b]));
    const orgMap = new Map(targets.orgs.map((o) => [o.org_id, o]));
    const board = boardMap.get(log.board_id);
    if (board) {
      boardConfig = board;
      const org = orgMap.get(board.org_id);
      if (org) {
        orgConfig = {
          org_id: org.org_id,
          org_name: org.org_name,
          base_url: org.base_url,
        };
      }
    }
    
    const errorType = classifyErrorType(log.error_message);
    const errorTypeLabel = ERROR_TYPE_LABELS[errorType];
    
    // LLM 프롬프트 구성
    const systemPrompt = `당신은 웹 스크래핑 시스템의 에러 분석 전문가입니다.
주어진 에러 로그와 보드 설정을 분석하여 에러 원인을 파악하고 해결 방안을 제시해주세요.

분석 결과는 반드시 아래 JSON 형식으로 출력하세요:
{
  "summary": "에러 원인 요약 (1-2문장)",
  "possible_causes": ["가능한 원인 1", "가능한 원인 2", ...],
  "suggested_actions": ["권장 조치 1", "권장 조치 2", ...],
  "confidence": "high" | "medium" | "low",
  "additional_notes": "추가 참고사항 (선택)"
}`;

    const userPrompt = `## 에러 로그 정보

- **로그 ID**: ${log.log_id}
- **보드 ID**: ${log.board_id}
- **상태**: ${log.status}
- **에러 유형**: ${errorTypeLabel} (${errorType})
- **시작 시간**: ${log.started_at}
- **종료 시간**: ${log.finished_at || "진행 중"}
- **수집 문서**: ${log.docs_scraped}건
- **실패 문서**: ${log.docs_failed}건
- **건너뛴 문서**: ${log.docs_skipped}건
- **처리 페이지**: ${log.pages_processed}페이지

### 에러 메시지
\`\`\`
${log.error_message || "에러 메시지 없음"}
\`\`\`

## 보드 설정 정보

${boardConfig ? `
- **기관명**: ${orgConfig?.org_name || "알 수 없음"}
- **기관 ID**: ${orgConfig?.org_id || "알 수 없음"}
- **기관 URL**: ${orgConfig?.base_url || "알 수 없음"}
- **보드명**: ${boardConfig.board_name || boardConfig.board_id}
- **수집 모드**: ${boardConfig.access_mode || "web"}
- **목록 URL**: ${boardConfig.list_url || "설정 안됨"}
- **상세 URL 패턴**: ${boardConfig.detail_url_pattern || "설정 안됨"}
- **페이지네이션 타입**: ${boardConfig.pagination?.type || "설정 안됨"}
${boardConfig.selectors ? `
### 셀렉터 설정
- 리스트 행: ${boardConfig.selectors.list_row || "설정 안됨"}
- 제목: ${boardConfig.selectors.title || "설정 안됨"}
- 링크: ${boardConfig.selectors.link || "설정 안됨"}
- 날짜: ${boardConfig.selectors.date || "설정 안됨"}
` : ""}
` : "보드 설정 정보를 찾을 수 없음"}

---

위 정보를 분석하여 에러 원인과 해결 방안을 JSON 형식으로 제시해주세요.`;

    // LLM 호출
    const result = await llmChatJson<AnalysisResult>({
      provider,
      model_mode: model ? "manual" : "auto",
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    
    return NextResponse.json({
      analysis: result,
      log_info: {
        log_id: log.log_id,
        board_id: log.board_id,
        error_type: errorType,
        error_type_label: errorTypeLabel,
      },
      provider_used: provider,
      model_used: model || "auto",
    });
    
  } catch (err: any) {
    console.error("[scraper/logs/analyze] POST error:", err);
    
    // LLM 설정 오류 처리
    if (err.message?.includes("llm_not_configured")) {
      const provider = err.message.replace("llm_not_configured_", "");
      return NextResponse.json({
        error: `${provider.toUpperCase()} API 키가 설정되지 않았습니다. .env.local 파일에 API 키를 설정해주세요.`,
        code: "LLM_NOT_CONFIGURED",
      }, { status: 400 });
    }
    
    return NextResponse.json({ error: err.message || "분석 실패" }, { status: 500 });
  }
}

// LLM 모델 목록 캐시 (1시간)
let modelsCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1시간

async function fetchOpenAIModels(): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data?.data ?? [])
      .map((m: any) => m?.id)
      .filter((id: string) => /^(gpt-|chatgpt)/i.test(id))
      .filter((id: string) => !/embedding|whisper|tts|dall-e|davinci|babbage|ada/i.test(id))
      .sort((a: string, b: string) => {
        // 최신 버전 우선 정렬
        const getScore = (s: string) => {
          if (/gpt-5/i.test(s)) return 5000;
          if (/gpt-4\.5/i.test(s)) return 4500;
          if (/gpt-4o/i.test(s)) return 4200;
          if (/gpt-4-turbo/i.test(s)) return 4100;
          if (/gpt-4/i.test(s)) return 4000;
          if (/gpt-3\.5/i.test(s)) return 3500;
          return 0;
        };
        return getScore(b) - getScore(a);
      });
    return models.slice(0, 10); // 상위 10개만
  } catch {
    return [];
  }
}

async function fetchGeminiModels(): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data?.models ?? [])
      .map((m: any) => String(m?.name ?? "").replace(/^models\//, ""))
      .filter((id: string) => /gemini/i.test(id))
      .filter((id: string) => !/embedding|vision|aqa/i.test(id))
      .sort((a: string, b: string) => {
        const getScore = (s: string) => {
          if (/gemini-3/i.test(s)) return 3000;
          if (/gemini-2/i.test(s)) return 2000;
          if (/gemini-1\.5/i.test(s)) return 1500;
          if (/gemini-1/i.test(s)) return 1000;
          return 0;
        };
        return getScore(b) - getScore(a);
      });
    return models.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchAnthropicModels(): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) {
      // API 목록이 없으면 알려진 최신 모델 반환
      return [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-latest",
        "claude-3-opus-latest",
        "claude-3-5-haiku-latest",
      ];
    }
    const data = await res.json();
    const models = (data?.data ?? [])
      .map((m: any) => m?.id)
      .filter((id: string) => /claude/i.test(id))
      .sort((a: string, b: string) => {
        const getScore = (s: string) => {
          if (/claude-5|claude-sonnet-5|claude-opus-5/i.test(s)) return 5000;
          if (/claude-4|claude-sonnet-4|claude-opus-4/i.test(s)) return 4000;
          if (/claude-3-5|claude-3\.5/i.test(s)) return 3500;
          if (/claude-3/i.test(s)) return 3000;
          return 0;
        };
        return getScore(b) - getScore(a);
      });
    return models.length > 0 ? models.slice(0, 10) : [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-latest",
      "claude-3-opus-latest",
    ];
  } catch {
    return [
      "claude-sonnet-4-20250514",
      "claude-3-5-sonnet-latest",
      "claude-3-opus-latest",
    ];
  }
}

/**
 * GET /api/scraper/logs/analyze/providers
 * 사용 가능한 LLM 제공자 목록 반환 (실시간 모델 목록 조회)
 */
export async function GET() {
  // 캐시 확인
  const now = Date.now();
  if (modelsCache && (now - modelsCache.timestamp) < CACHE_TTL) {
    return NextResponse.json(modelsCache.data);
  }
  
  // 모델 목록 병렬 조회
  const [openaiModels, geminiModels, anthropicModels] = await Promise.all([
    fetchOpenAIModels(),
    fetchGeminiModels(),
    fetchAnthropicModels(),
  ]);
  
  const providers = [
    {
      id: "openai",
      name: "OpenAI (GPT)",
      configured: !!process.env.OPENAI_API_KEY,
      models: openaiModels.length > 0 ? openaiModels : ["gpt-4o", "gpt-4o-mini"],
      recommended: openaiModels[0] || "gpt-4o",
    },
    {
      id: "gemini",
      name: "Google Gemini",
      configured: !!process.env.GEMINI_API_KEY,
      models: geminiModels.length > 0 ? geminiModels : ["gemini-2.0-flash", "gemini-1.5-pro"],
      recommended: geminiModels[0] || "gemini-2.0-flash",
    },
    {
      id: "anthropic",
      name: "Anthropic Claude",
      configured: !!process.env.ANTHROPIC_API_KEY,
      models: anthropicModels,
      recommended: anthropicModels[0] || "claude-sonnet-4-20250514",
    },
  ];
  
  const result = { 
    providers,
    updated_at: new Date().toISOString(),
    note: "모델 목록은 각 API에서 실시간 조회됩니다. Auto 모드 사용 시 최신 모델이 자동 선택됩니다.",
  };
  
  // 캐시 저장
  modelsCache = { data: result, timestamp: now };
  
  return NextResponse.json(result);
}
