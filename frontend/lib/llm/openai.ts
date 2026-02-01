export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatJson<T>({
  messages,
  model = "gpt-4o-mini",
  temperature = 0.1,
  max_tokens = 16384,  // gpt-4o-mini 최대 출력 토큰
}: {
  messages: OpenAIChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env["\uFEFFOPENAI_API_KEY"];
  if (!apiKey) throw new Error("llm_not_configured");

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

  const baseBody: any = {
    model,
    max_tokens,
    messages,
    response_format: { type: "json_object" },
    temperature,
  };

  let { res, data } = await doReq(baseBody);
  if (!res.ok) {
    const msg = data?.error?.message ? String(data.error.message) : "llm_request_failed";
    if (msg.toLowerCase().includes("temperature")) {
      const retryBody = { ...baseBody };
      delete retryBody.temperature;
      ({ res, data } = await doReq(retryBody));
    }
  }

  if (!res.ok) {
    const msg = data?.error?.message ? String(data.error.message) : "llm_request_failed";
    throw new Error(msg);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("llm_empty_response");

  return JSON.parse(content) as T;
}


