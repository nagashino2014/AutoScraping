import type { OpenAIChatMessage } from "@/lib/llm/openai";

type Provider = "openai" | "gemini" | "anthropic";
type ModelMode = "auto" | "manual";

function normalizeProvider(raw?: string): Provider {
  const v = (raw ?? "").toLowerCase().trim();
  if (v === "gemini" || v === "google") return "gemini";
  if (v === "anthropic" || v === "claude") return "anthropic";
  return "openai";
}

function normalizeModelMode(raw?: string): ModelMode {
  const v = (raw ?? "").toLowerCase().trim();
  return v === "manual" ? "manual" : "auto";
}

function scoreModelName(name: string): number[] {
  // 이름에서 숫자 시퀀스를 뽑아 비교용 점수로 사용
  const nums = (name.match(/\d+(\.\d+)*/g) ?? [])
    .map((s) => s.split(".").map((x) => Number(x)))
    .flat();
  if (nums.length === 0) return [0];
  return nums;
}

function compareScore(a: number[], b: number[]) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return y - x; // desc
  }
  return 0;
}

async function openaiListModels(): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env["\uFEFFOPENAI_API_KEY"];
  if (!apiKey) throw new Error("llm_not_configured_openai");
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error("llm_models_list_failed");
  const ids = (data?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
  return ids;
}

function pickOpenAiModelAuto(models: string[]): string {
  // 블랙리스트 방식: chat/completions 미지원 또는 json_object 미지원 모델 제외
  const BLOCKED_PATTERNS = [
    "embedding", "tts", "audio", "transcribe", "realtime", "instruct",
    "search", "whisper", "dall-e", "davinci", "babbage", "ada",
    // /v1/responses 전용 모델 (reasoning 모델) - 이들은 chat/completions 미지원
    "o1-preview", "o1-mini", "o3-mini", "o3-", "o4-",
    // codex, nano 등 특수 모델
    "codex", "nano",
  ];
  
  // chat/completions + json_object 지원 확인된 모델 패턴
  // 우선순위: gpt-5-chat > gpt-5 (non-codex) > gpt-4o > gpt-4-turbo > gpt-4 > gpt-3.5
  const SAFE_CHAT_PATTERNS = [
    // GPT-5 chat 모델 (chat/completions 명시된 것만)
    /^gpt-5-chat/i,
    /^gpt-5-pro(?!.*codex)/i,
    /^gpt-5(?!.*(codex|nano|mini))/i,
    // GPT-4.5
    /^gpt-4\.5/i,
    // GPT-4o 계열 (검증됨)
    /^gpt-4o/i,
    // GPT-4 turbo (검증됨)
    /^gpt-4-turbo/i,
    // GPT-4 기본 (검증됨)
    /^gpt-4(?!o)/i,
    // GPT-3.5 (폴백)
    /^gpt-3\.5-turbo/i,
    // chatgpt 브랜드 모델 (보통 최신 chat 모델 래핑)
    /^chatgpt/i,
  ];

  const isSafeChat = (id: string) => {
    const s = id.toLowerCase();
    // 블랙리스트 체크
    if (BLOCKED_PATTERNS.some((b) => s.includes(b))) return false;
    // 화이트리스트 패턴 매칭
    return SAFE_CHAT_PATTERNS.some((p) => p.test(s));
  };

  // 버전 점수 계산 (높을수록 최신/선호)
  const getVersionScore = (id: string): number => {
    const s = id.toLowerCase();
    // GPT-5 chat = 5100
    if (/gpt-5-chat/.test(s)) return 5100;
    // GPT-5 pro (non-codex) = 5050
    if (/gpt-5-pro/.test(s) && !/codex/.test(s)) return 5050;
    // GPT-5 기본 = 5000
    if (/gpt-5(?!.*(codex|nano|mini))/.test(s)) return 5000;
    // GPT-4.5 = 4500
    if (/gpt-4\.5/.test(s)) return 4500;
    // chatgpt (래퍼) = 4350
    if (/chatgpt/.test(s)) return 4350;
    // GPT-4o standard = 4200
    if (/gpt-4o(?!-mini)/.test(s)) return 4200;
    // GPT-4o-mini = 4100
    if (/gpt-4o-mini/.test(s)) return 4100;
    // GPT-4-turbo = 4050
    if (/gpt-4-turbo/.test(s)) return 4050;
    // GPT-4 = 4000
    if (/gpt-4/.test(s)) return 4000;
    // GPT-3.5 = 3500
    if (/gpt-3\.5/.test(s)) return 3500;
    return 0;
  };

  const preferred = models
    .filter(isSafeChat)
    .sort((a, b) => getVersionScore(b) - getVersionScore(a));

  // 폴백: gpt-4o (가장 안전하고 검증된 모델)
  const chosen = preferred[0] ?? "gpt-4o";
  console.log(`[OpenAI Auto] Available: ${models.length} models, Filtered: ${preferred.length}, Chosen: ${chosen}`);
  return chosen;
}

function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = text.slice(start, end + 1);
      return JSON.parse(sliced) as T;
    }
    throw new Error("llm_non_json_response");
  }
}

async function geminiListModels(): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("llm_not_configured_gemini");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error("llm_models_list_failed");
  const names = (data?.models ?? [])
    .map((m: any) => String(m?.name ?? ""))
    .filter(Boolean)
    .map((n: string) => n.replace(/^models\//, ""));
  return names;
}

function pickGeminiModelAuto(models: string[]): string {
  // Gemini 모델 버전 점수 (높을수록 최신/고성능)
  const getVersionScore = (id: string): number => {
    const s = id.toLowerCase();
    // 블랙리스트: embedding, vision-only, code 등
    if (/embedding|vision|code|nano|aqa/.test(s)) return 0;
    
    // Gemini 3.x = 3000+
    if (/gemini-3/.test(s)) {
      const minor = s.match(/gemini-3\.?(\d+)?/)?.[1];
      return 3000 + (minor ? parseInt(minor) * 10 : 0) + (s.includes("pro") ? 5 : s.includes("ultra") ? 10 : 0);
    }
    // Gemini 2.x = 2000+
    if (/gemini-2/.test(s)) {
      const minor = s.match(/gemini-2\.?(\d+)?/)?.[1];
      return 2000 + (minor ? parseInt(minor) * 10 : 0) + (s.includes("pro") ? 5 : s.includes("ultra") ? 10 : s.includes("flash") ? 2 : 0);
    }
    // Gemini 1.5 = 1500+
    if (/gemini-1\.5/.test(s)) {
      return 1500 + (s.includes("pro") ? 5 : s.includes("ultra") ? 10 : s.includes("flash") ? 2 : 0);
    }
    // Gemini 1.0 = 1000+
    if (/gemini-1\.0|gemini-pro|gemini-ultra/.test(s)) {
      return 1000 + (s.includes("ultra") ? 10 : s.includes("pro") ? 5 : 0);
    }
    return 0;
  };

  const candidates = models
    .filter((m) => m.toLowerCase().includes("gemini"))
    .filter((m) => getVersionScore(m) > 0)
    .sort((a, b) => getVersionScore(b) - getVersionScore(a));

  const chosen = candidates[0] ?? "gemini-2.0-flash";
  console.log(`[Gemini Auto] Available: ${models.length} models, Filtered: ${candidates.length}, Chosen: ${chosen}`);
  return chosen;
}

async function anthropicListModels(): Promise<string[] | null> {
  // 일부 환경에서는 목록 API가 없거나 권한이 제한될 수 있으므로 best-effort
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("llm_not_configured_anthropic");
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  }).catch(() => null);
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) return null;
  const ids = (data?.data ?? []).map((m: any) => String(m?.id ?? "")).filter(Boolean);
  return ids;
}

function pickAnthropicModelAuto(models: string[] | null): string {
  // Claude 모델 버전 점수 (높을수록 최신/고성능)
  const getVersionScore = (id: string): number => {
    const s = id.toLowerCase();
    
    // Claude 5.x = 5000+
    if (/claude-5/.test(s)) {
      return 5000 + (s.includes("opus") ? 10 : s.includes("sonnet") ? 5 : 0);
    }
    // Claude 4.x = 4000+
    if (/claude-4/.test(s)) {
      const minor = s.match(/claude-4\.?(\d+)?/)?.[1];
      return 4000 + (minor ? parseInt(minor) * 10 : 0) + (s.includes("opus") ? 10 : s.includes("sonnet") ? 5 : 0);
    }
    // Claude 3.5 = 3500+
    if (/claude-3-5|claude-3\.5/.test(s)) {
      return 3500 + (s.includes("opus") ? 10 : s.includes("sonnet") ? 5 : 0);
    }
    // Claude 3 = 3000+
    if (/claude-3/.test(s)) {
      return 3000 + (s.includes("opus") ? 10 : s.includes("sonnet") ? 5 : s.includes("haiku") ? 2 : 0);
    }
    // Claude 2.x = 2000+
    if (/claude-2/.test(s)) {
      return 2000;
    }
    return 0;
  };

  // 환경변수 폴백
  const envModel = process.env.ANTHROPIC_MODEL;
  const fallback = "claude-sonnet-4-20250514"; // 2025년 최신 모델
  
  if (!models || models.length === 0) {
    // API 목록 없으면 환경변수 또는 "latest" 별칭 사용
    return envModel || "claude-3-5-sonnet-latest";
  }
  
  const candidates = models
    .filter((m) => m.toLowerCase().includes("claude"))
    .filter((m) => getVersionScore(m) > 0)
    .sort((a, b) => getVersionScore(b) - getVersionScore(a));

  // Opus > Sonnet > 기타 순으로 최신 버전 선택
  const chosen = candidates[0] ?? envModel ?? fallback;
  console.log(`[Anthropic Auto] Available: ${models?.length ?? 0} models, Filtered: ${candidates.length}, Chosen: ${chosen}`);
  return chosen;
}

async function openaiChatJson<T>({
  messages,
  model,
  temperature = 0.1,
  max_tokens = 16384,  // gpt-4o-mini/gpt-4o 최대 출력 토큰
}: {
  messages: OpenAIChatMessage[];
  model: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env["\uFEFFOPENAI_API_KEY"];
  if (!apiKey) throw new Error("llm_not_configured_openai");
  console.log(`[OpenAI] Using model: ${model}, max_tokens: ${max_tokens}`);
  const baseBody: any = {
    model,
    max_tokens,
    messages,
    response_format: { type: "json_object" },
    // 일부 모델은 temperature를 허용하지 않아 실패할 수 있어 우선 포함하되, 실패 시 재시도한다.
    temperature,
  };

  const doReq = async (body: any) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as any;
    return { res, data };
  };

  let { res, data } = await doReq(baseBody);
  if (!res.ok) {
    const raw = data?.error?.message ? String(data.error.message) : "llm_request_failed";
    // /v1/responses 전용 모델인 경우(o1, o3, o4 등)
    if (raw.includes("v1/responses") || raw.includes("not supported")) {
      throw new Error("openai_model_responses_only");
    }
    if (raw.includes("not a chat model")) throw new Error("openai_model_not_chat_compatible");

    // temperature 비호환 모델 대응: temperature 제거 후 1회 재시도
    if (raw.toLowerCase().includes("temperature")) {
      const retryBody = { ...baseBody };
      delete retryBody.temperature;
      ({ res, data } = await doReq(retryBody));
    }

    // response_format 비호환 모델 대응: response_format 제거 후 1회 재시도
    const msg2 = data?.error?.message ? String(data.error.message) : raw;
    if (msg2.includes("response format") && msg2.includes("json_object")) {
      const retryBody = { ...baseBody };
      delete retryBody.response_format;
      ({ res, data } = await doReq(retryBody));
    }
  }

  if (!res.ok) {
    const raw = data?.error?.message ? String(data.error.message) : "llm_request_failed";
    if (raw.includes("not a chat model")) throw new Error("openai_model_not_chat_compatible");
    if (raw.toLowerCase().includes("temperature")) throw new Error("openai_model_temperature_not_supported");
    if (raw.includes("response format") && raw.includes("json_object")) {
      throw new Error("openai_model_response_format_not_supported");
    }
    throw new Error(raw);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("llm_empty_response");
  return parseJsonLoose<T>(String(content));
}

async function geminiChatJson<T>({
  messages,
  model,
}: {
  messages: OpenAIChatMessage[];
  model: string;
}): Promise<T> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("llm_not_configured_gemini");
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}\n\n반드시 JSON만 출력.` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },  // Gemini 출력 토큰 증가
      }),
    }
  );
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(data?.error?.message ? String(data.error.message) : "llm_request_failed");
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  if (!text) throw new Error("llm_empty_response");
  return parseJsonLoose<T>(text);
}

async function anthropicChatJson<T>({
  messages,
  model,
}: {
  messages: OpenAIChatMessage[];
  model: string;
}): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("llm_not_configured_anthropic");
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,  // Anthropic 출력 토큰 증가
      system: `${system}\n\n반드시 JSON만 출력.`,
      messages: [{ role: "user", content: user }],
      temperature: 0.1,
    }),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(data?.error?.message ? String(data.error.message) : "llm_request_failed");
  const text =
    (data?.content ?? [])
      .map((c: any) => (c?.type === "text" ? c?.text : ""))
      .join("") ?? "";
  if (!text) throw new Error("llm_empty_response");
  return parseJsonLoose<T>(text);
}

export async function llmChatJson<T>({
  provider,
  model_mode,
  model,
  messages,
}: {
  provider?: string;
  model_mode?: string;
  model?: string;
  messages: OpenAIChatMessage[];
}): Promise<T> {
  const p = normalizeProvider(provider);
  const mm = normalizeModelMode(model_mode);

  if (p === "openai") {
    const chosen =
      mm === "manual" && model?.trim()
        ? model.trim()
        : pickOpenAiModelAuto(await openaiListModels().catch(() => []));
    return await openaiChatJson<T>({ messages, model: chosen });
  }

  if (p === "gemini") {
    const chosen =
      mm === "manual" && model?.trim()
        ? model.trim()
        : pickGeminiModelAuto(await geminiListModels().catch(() => []));
    return await geminiChatJson<T>({ messages, model: chosen });
  }

  const models = mm === "manual" ? null : await anthropicListModels().catch(() => null);
  const chosen = mm === "manual" && model?.trim() ? model.trim() : pickAnthropicModelAuto(models);
  return await anthropicChatJson<T>({ messages, model: chosen });
}


