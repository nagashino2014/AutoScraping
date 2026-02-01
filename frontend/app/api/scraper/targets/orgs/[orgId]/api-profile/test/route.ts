import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";

export const runtime = "nodejs";

type TestRequest = {
  api_profile: Record<string, any>;
  endpoint: {
    name?: string;
    path?: string;
    method?: string;
    url?: string;
    fixed_params?: Record<string, any>;
  };
  params?: Record<string, any>;
  secret_override?: string; // 저장하지 않는 임시 값
};

function getEnvSecret(ref?: string) {
  if (!ref) return null;
  if (!ref.startsWith("ENV:")) return null;
  const key = ref.slice("ENV:".length);
  if (!key) return null;
  return process.env[key] ?? null;
}

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  const org = data.orgs.find((o) => o.org_id === orgId) ?? null;
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as TestRequest | null;
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });

  // 서버에 저장된 org.api_profile을 우선 사용하고, 클라이언트에서 보낸 것으로 보완
  const serverApiProfile = (org as any).api_profile ?? {};
  const clientApiProfile = body.api_profile ?? {};
  const api_profile = { ...serverApiProfile, ...clientApiProfile };
  
  const endpointInput = body.endpoint ?? {};
  // base_url 우선순위: 클라이언트 api_profile > 서버 api_profile > org.base_url
  const base_url = String(clientApiProfile.base_url ?? serverApiProfile.base_url ?? org.base_url ?? "").trim();
  if (!base_url) return NextResponse.json({ error: "missing_base_url", hint: "base_url을 찾을 수 없습니다." }, { status: 400 });

  const inputPath = String(endpointInput.path ?? "").trim();
  const method = String(endpointInput.method ?? "GET").toUpperCase();
  const url =
    String(endpointInput.url ?? "").trim() ||
    (inputPath ? new URL(inputPath, base_url).toString() : "");
  if (!url) {
    console.log("[Test] Missing endpoint:", { inputPath, base_url, endpointInput });
    return NextResponse.json({ 
      error: "missing_endpoint", 
      hint: `endpoint.path가 비어있습니다. 전달받은 값: path="${inputPath}", base_url="${base_url}"` 
    }, { status: 400 });
  }

  // api_profile.endpoints에서 매칭되는 엔드포인트 찾기 (path 기준)
  const endpoints = Array.isArray(api_profile.endpoints) ? api_profile.endpoints : [];
  const matchedEndpoint = endpoints.find((ep: any) => {
    const epPath = String(ep?.path ?? "").trim();
    return epPath && inputPath.includes(epPath);
  }) ?? {};

  // 매칭된 엔드포인트의 fixed_params와 입력된 fixed_params 병합
  const endpoint = {
    ...matchedEndpoint,
    ...endpointInput,
    fixed_params: { ...(matchedEndpoint.fixed_params ?? {}), ...(endpointInput.fixed_params ?? {}) },
  };

  const auth = api_profile.auth ?? {};
  const authType = String(auth.type ?? "").trim().toLowerCase();
  const authIn = String(auth.in ?? "query").trim().toLowerCase(); // header | query (기본값 query)
  // auth.name 또는 auth.param_name 둘 다 지원
  const authName = String(auth.param_name ?? auth.name ?? "").trim();
  const secretRef = String(auth.secret_ref ?? "").trim();

  const secret =
    (body.secret_override ?? "").trim() ||
    getEnvSecret(secretRef) ||
    null;

  // 인증 필요한데 secret이 없으면 에러 (단, multi 타입은 별도 처리 필요)
  if (authType && authType !== "unknown" && authName && !secret) {
    const envKey = secretRef.startsWith("ENV:") ? secretRef.slice(4) : secretRef;
    const hint = [
      `인증 파라미터 "${authName}"에 대한 시크릿을 찾을 수 없습니다.`,
      ``,
      `해결 방법:`,
      `1. .env.local 파일에 다음 환경변수 추가:`,
      `   ${envKey}=실제_API키_또는_사용자ID`,
      ``,
      `2. 또는 테스트 시 "시크릿 직접 입력" 필드에 값 입력`,
      ``,
      `현재 설정: auth.secret_ref = "${secretRef}"`,
    ].join("\n");
    console.log("[Test] Missing secret:", { authType, authName, secretRef, envKey });
    return NextResponse.json({ error: "missing_secret_for_test", hint }, { status: 400 });
  }

  const finalUrl = new URL(url);

  // 1. api_profile.default_params 적용 (가장 낮은 우선순위)
  const defaultParams = api_profile.default_params ?? {};
  for (const [k, v] of Object.entries(defaultParams)) {
    if (v === undefined || v === null || v === "") continue;
    finalUrl.searchParams.set(k, String(v));
  }

  // 2. endpoint.fixed_params 적용 (엔드포인트별 고정값, 중간 우선순위)
  const fixedParams = endpoint.fixed_params ?? {};
  for (const [k, v] of Object.entries(fixedParams)) {
    if (v === undefined || v === null || v === "") continue;
    finalUrl.searchParams.set(k, String(v));
  }

  // 3. 사용자 입력 params 적용 (가장 높은 우선순위)
  const userParams = body.params ?? {};
  for (const [k, v] of Object.entries(userParams)) {
    if (v === undefined || v === null || v === "") continue;
    finalUrl.searchParams.set(k, String(v));
  }

  // 인증 파라미터 자동 추가 (type: param, apiKey, api_key 모두 지원)
  const isQueryAuth = ["param", "apikey", "api_key"].includes(authType) && authIn !== "header";
  if (secret && isQueryAuth && authName) {
    // 사용자가 params에 이미 넣었으면 덮어쓰지 않음
    if (!finalUrl.searchParams.has(authName)) {
      finalUrl.searchParams.set(authName, secret);
    }
  }

  const headers: Record<string, string> = { "User-Agent": "EcoMonitorBot/1.0 (api_profile_test)" };
  // 헤더 인증
  if (secret && authIn === "header" && authName) {
    headers[authName] = secret;
  }

  const res = await fetch(finalUrl.toString(), { method, headers }).catch(() => null);
  if (!res) return NextResponse.json({ error: "test_request_failed" }, { status: 400 });

  const text = await res.text().catch(() => "");
  const preview = text.slice(0, 5000);

  return NextResponse.json({
    ok: true,
    status: res.status,
    content_type: res.headers.get("content-type"),
    url: finalUrl.toString(),
    body_preview: preview,
  });
}


