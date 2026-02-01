import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { llmChatJson } from "@/lib/llm/client";

export const runtime = "nodejs";

type RefineRequest = {
  current_api_profile: Record<string, unknown>;
  user_feedback: string;
  user_context?: string;
  provider?: string;
  model_mode?: string;
  model?: string;
};

type RefineResponse = {
  api_profile: Record<string, unknown>;
  change_log?: string[];
  warnings?: string[];
};

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  const org = data.orgs.find((o) => o.org_id === orgId) ?? null;
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as RefineRequest | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  const feedback = (body.user_feedback ?? "").trim();
  if (!feedback) return NextResponse.json({ error: "missing_feedback" }, { status: 400 });

  const prompt = `
너는 기관 API 프로필(api_profile) 초안을 운영자 피드백에 따라 **정확하게** 수정하는 전문가다.
반드시 JSON만 출력한다.

## 수정 규칙

### 1. 엔드포인트 경로 수정
- 운영자가 "실제 경로는 /DRF/lawSearch.do이다" 같이 지적하면 **정확히 그대로** 반영하라.
- 추상적 경로(/api/법령목록)를 실제 경로로 교체하라.

### 2. 인증 방식 수정
- "OC만 필요", "authKey 필요", "둘 다 필요" 등의 피드백 반영
- 인증 분기:
  - OC만: auth.type="param", auth.param_name="OC"
  - authKey만: auth.type="apiKey", auth.param_name="authKey" 또는 "ServiceKey"
  - 둘 다: auth.type="multi"

### 3. 필수 파라미터 수정
- 운영자가 "target, type이 필수다" 지적하면 required_params에 추가
- 각 엔드포인트별로 필수 파라미터가 다를 수 있음

### 4. base_url 수정
- 프로토콜(http/https)이 다르다고 지적하면 정확히 수정
- 도메인이 다르면 수정

### 5. 응답 형식 수정
- "XML만 지원", "JSON 미지원" 등의 피드백 반영

### 핵심 원칙
- 시크릿(API Key/토큰 값)은 절대 포함하지 말고 auth.secret_ref는 ENV:... 참조만 사용
- 기존 구조를 최대한 유지하되, 피드백을 **정확히** 반영
- 변경한 내용을 change_log에 상세히 기록

## 출력 스키마
{
  "api_profile": { ...updated... },
  "change_log": ["변경1: ...", "변경2: ..."],
  "warnings": ["아직 확인 필요한 항목"]
}

## 입력 데이터

기관: ${org.org_name} (${org.org_id})
BASE_URL_HINT: ${org.base_url}

현재 api_profile:
${JSON.stringify(body.current_api_profile ?? {}, null, 2)}

사용자 피드백:
${feedback}

추가 컨텍스트(선택):
${(body.user_context ?? "").trim()}
  `.trim();

  try {
    const result = await llmChatJson<RefineResponse>({
      provider: body.provider,
      model_mode: body.model_mode,
      model: body.model,
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: prompt },
      ],
    });

    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    console.error("[api-profile/refine] Error:", e);
    const msg = String(e?.message ?? "refine_failed");
    const stack = String(e?.stack ?? "");
    if (msg.startsWith("llm_not_configured")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    // 더 자세한 오류 정보 반환
    return NextResponse.json({ 
      error: msg, 
      detail: stack.slice(0, 500),
      cause: String(e?.cause ?? ""),
    }, { status: 500 });
  }
}


