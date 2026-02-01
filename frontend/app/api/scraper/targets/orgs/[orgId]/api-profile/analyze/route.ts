import { NextResponse } from "next/server";
import { readScraperTargets } from "@/lib/scraper/targets-store";
import { llmChatJson } from "@/lib/llm/client";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 180_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

function stripHtmlToText(html: string) {
  let processed = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  
  // 표 구조 보존을 위한 치환
  processed = processed
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<\/th>/gi, "  ");

  const withoutTags = processed.replace(/<[^>]+>/g, " ");
  // 연속된 공백/줄바꿈 정리
  return withoutTags
    .replace(/\n\s*\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function extractTextFromFile(file: File): Promise<{ kind: string; text: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("file_too_large");

  const buf = Buffer.from(await file.arrayBuffer());
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();

  // PDF
  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const mod: any = await import("pdf-parse");
    const pdfParse = mod?.default ?? mod;
    const out = await pdfParse(buf);
    return { kind: "pdf", text: String(out?.text ?? "") };
  }

  // DOCX
  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mod: any = await import("mammoth");
    const mammoth = mod?.default ?? mod;
    const out = await mammoth.extractRawText({ buffer: buf });
    return { kind: "docx", text: String(out?.value ?? "") };
  }

  // XLSX
  if (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    name.endsWith(".xlsx")
  ) {
    const XLSX: any = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const chunks: string[] = [];
    for (const sheetName of wb.SheetNames ?? []) {
      const ws = wb.Sheets?.[sheetName];
      if (!ws) continue;
      const csv = XLSX.utils.sheet_to_csv(ws);
      chunks.push(`--- sheet: ${sheetName} ---\n${csv}`);
    }
    return { kind: "xlsx", text: chunks.join("\n\n") };
  }

  // Plain text
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return { kind: "text", text: buf.toString("utf8") };
  }

  // HWPX (ZIP + XML). HWP는 현 단계 미지원.
  if (name.endsWith(".hwp")) {
    throw new Error("file_type_not_supported_hwp");
  }
  if (name.endsWith(".hwpx")) {
    try {
      const mod: any = await import("adm-zip");
      const AdmZip = mod?.default ?? mod;
      const zip = new AdmZip(buf);
      const entries = zip.getEntries?.() ?? [];

      const xmlFiles = entries
        .map((e: any) => String(e.entryName ?? ""))
        .filter((p: string) => /\/Contents\/section\d+\.xml$/i.test(p) || /\/Contents\/header\.xml$/i.test(p));

      const texts: string[] = [];
      const decodeEntities = (s: string) =>
        s
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

      const extractFromXml = (xml: string) => {
        const out: string[] = [];
        const patterns = [
          /<hp:t[^>]*>([\s\S]*?)<\/hp:t>/gi,
          /<w:t[^>]*>([\s\S]*?)<\/w:t>/gi,
        ];
        for (const re of patterns) {
          let m: RegExpExecArray | null;
          // eslint-disable-next-line no-cond-assign
          while ((m = re.exec(xml))) {
            const t = decodeEntities(m[1].replace(/<[^>]+>/g, " ").trim());
            if (t) out.push(t);
          }
        }
        if (out.length === 0) {
          const fallback = decodeEntities(xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (fallback) out.push(fallback);
        }
        return out.join("\n");
      };

      for (const p of xmlFiles) {
        const e = entries.find((x: any) => String(x.entryName ?? "") === p);
        if (!e) continue;
        const xml = String(e.getData().toString("utf8") ?? "");
        texts.push(extractFromXml(xml));
      }

      const combined = texts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!combined) throw new Error("hwpx_extract_failed");
      return { kind: "hwpx", text: combined };
    } catch (e: any) {
      const msg = e?.message ?? "hwpx_extract_failed";
      throw new Error(msg);
    }
  }

  throw new Error("file_type_not_supported");
}

type ApiProfileProposal = {
  api_profile: Record<string, unknown>;
  warnings?: string[];
  summary?: string;
};

export async function POST(_req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  // 디버깅: 환경변수 및 경로 확인
  console.log("[Analyze] CWD:", process.cwd());
  console.log("[Analyze] OPENAI_API_KEY exists:", !!process.env.OPENAI_API_KEY);
  console.log("[Analyze] GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);
  console.log("[Analyze] ANTHROPIC_API_KEY exists:", !!process.env.ANTHROPIC_API_KEY);
  
  const { orgId } = await ctx.params;
  const data = readScraperTargets();
  const org = data.orgs.find((o) => o.org_id === orgId) ?? null;
  if (!org) return NextResponse.json({ error: "org_not_found" }, { status: 404 });

  const form = await _req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const url = String(form.get("url") ?? "").trim();
  const file = form.get("file");
  const extraContext = String(form.get("context") ?? "").trim();
  const selectedEndpointsRaw = String(form.get("selected_endpoints") ?? "").trim();
  const provider = String(form.get("provider") ?? "").trim();
  const model_mode = String(form.get("model_mode") ?? "").trim(); // auto | manual
  const model = String(form.get("model") ?? "").trim();

  // 선택된 엔드포인트 파싱
  let selectedEndpoints: any[] = [];
  if (selectedEndpointsRaw) {
    try {
      selectedEndpoints = JSON.parse(selectedEndpointsRaw);
      console.log("[Analyze Route] Received endpoints count:", selectedEndpoints.length);
      console.log("[Analyze Route] Endpoint titles:", selectedEndpoints.map((ep: any) => ep.title));
    } catch (e) {
      console.error("[Analyze Route] Failed to parse selected_endpoints:", e);
    }
  }

  if (!url && !(file instanceof File) && selectedEndpoints.length === 0) {
    return NextResponse.json({ error: "missing_input" }, { status: 400 });
  }

  let urlText = "";
  let fileText = "";
  let fileKind = "";

  if (url) {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "EcoMonitorBot/1.0 (api_profile_analyzer)" },
    }).catch(() => null);
    if (!res || !res.ok) {
      return NextResponse.json({ error: "url_fetch_failed" }, { status: 400 });
    }
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text().catch(() => "");
    urlText = ct.toLowerCase().includes("text/html") ? stripHtmlToText(raw) : raw;

    // [Open Law 특화] guideList.do에서 상세 링크 추출
    if (url.includes("open.law.go.kr") && url.includes("guideList.do")) {
      const guideMatches = [...raw.matchAll(/goGuideView\(['"]([^'"]+)['"]\)/g)];
      const htmlNames = [...new Set(guideMatches.map((m) => m[1]))]; // 중복 제거

      if (htmlNames.length > 0) {
        const detailBase = "https://open.law.go.kr/LSO/openApi/guideResult.do";
        // 최대 10개 정도로 제한하여 병렬 Fetch (타임아웃 방지)
        const targets = htmlNames.slice(0, 10);
        
        const detailTexts = await Promise.all(
          targets.map(async (name) => {
            const detailUrl = `${detailBase}?htmlName=${name}`;
            const dRes = await fetch(detailUrl, {
              headers: { "User-Agent": "EcoMonitorBot/1.0 (api_profile_analyzer_detail)" },
            }).catch(() => null);
            if (!dRes || !dRes.ok) return "";
            const dRaw = await dRes.text().catch(() => "");
            const dText = stripHtmlToText(dRaw);
            return `\n--- [Detail: ${name}] ---\n${dText}`;
          })
        );
        
        urlText += "\n\n" + detailTexts.join("\n");
      }
    }
  }

  if (file instanceof File) {
    const out = await extractTextFromFile(file);
    fileKind = out.kind;
    fileText = out.text;
  }

  // 선택된 엔드포인트 정보를 텍스트로 변환 (전체 데이터 포함)
  let selectedEndpointsText = "";
  if (selectedEndpoints.length > 0) {
    console.log("[Analyze Route] Building endpoint text for", selectedEndpoints.length, "endpoints");
    selectedEndpoints.forEach((ep: any, i: number) => {
      console.log(`[Analyze Route] EP ${i + 1}: ${ep.title}, params: ${ep.request_params?.length || 0}, fields: ${ep.response_fields?.length || 0}`);
    });
    
    // 각 엔드포인트별 파라미터/필드 개수 집계
    const epSummaries = selectedEndpoints.map((ep: any, i: number) => ({
      name: ep.title,
      params: ep.request_params?.length || 0,
      fields: ep.response_fields?.length || 0
    }));
    
    selectedEndpointsText = "SELECTED_ENDPOINTS (사용자가 선택한 엔드포인트 - 이 정보를 기반으로 api_profile 생성):\n\n" + 
      selectedEndpoints.map((ep: any, i: number) => {
        const parts = [`=== ${i + 1}. ${ep.title} ===`];
        if (ep.category) parts.push(`카테고리: ${ep.category}`);
        if (ep.request_url) parts.push(`요청URL: ${ep.request_url}`);
        if (ep.detail_url) parts.push(`상세페이지: ${ep.detail_url}`);
        
        // 요청 파라미터 상세 정보
        if (ep.request_params && ep.request_params.length > 0) {
          parts.push(`\n요청 파라미터 (${ep.request_params.length}개) - 전부 포함 필수:`);
          ep.request_params.forEach((param: any) => {
            const paramInfo = [`  - ${param.name}`];
            if (param.type) paramInfo.push(`타입: ${param.type}`);
            if (param.required) paramInfo.push(`필수: ${param.required}`);
            if (param.description) paramInfo.push(`설명: ${param.description}`);
            parts.push(paramInfo.join(", "));
          });
        }
        
        // 응답 필드 상세 정보
        if (ep.response_fields && ep.response_fields.length > 0) {
          parts.push(`\n응답 필드 (${ep.response_fields.length}개) - 전부 포함 필수:`);
          ep.response_fields.forEach((field: any) => {
            const fieldInfo = [`  - ${field.name}`];
            if (field.type) fieldInfo.push(`타입: ${field.type}`);
            if (field.description) fieldInfo.push(`설명: ${field.description}`);
            parts.push(fieldInfo.join(", "));
          });
        }
        
        // raw_content가 있으면 일부 포함
        if (ep.raw_content) {
          parts.push(`\n원본 내용 (요약):\n${ep.raw_content.substring(0, 2000)}...`);
        }
        
        return parts.join("\n");
      }).join("\n\n---\n\n");
    
    // 최종 요약 추가 (LLM이 검증할 수 있도록)
    selectedEndpointsText += "\n\n=== 검증 체크리스트 ===\n";
    selectedEndpointsText += `총 ${selectedEndpoints.length}개 엔드포인트를 endpoints 배열에 포함해야 함.\n`;
    selectedEndpointsText += "각 엔드포인트별 필수 포함 개수:\n";
    epSummaries.forEach((s, i) => {
      selectedEndpointsText += `  ${i + 1}. ${s.name}: request_params ${s.params}개, response_fields ${s.fields}개\n`;
    });
  }

  // 순서 조정: selectedEndpointsText를 우선 배치 (잘리지 않도록)
  const combinedParts = [
    `ORG: ${org.org_name} (${org.org_id})`,
    `BASE_URL_HINT: ${org.base_url}`,
    url ? `GUIDE_URL: ${url}` : "",
    file instanceof File ? `UPLOAD_FILE: ${file.name} (${fileKind || file.type || "unknown"})` : "",
    selectedEndpointsText,
    extraContext ? `USER_CONTEXT:\n${extraContext}` : "",
    urlText ? `URL_TEXT:\n${urlText}` : "",
    fileText ? `FILE_TEXT:\n${fileText}` : "",
  ].filter(Boolean);
  
  const combinedRaw = combinedParts.join("\n\n");
  const combined = combinedRaw.slice(0, MAX_TEXT_CHARS);
  
  console.log("[Analyze Route] Combined text length:", combinedRaw.length, "-> truncated to:", combined.length);
  console.log("[Analyze Route] selectedEndpointsText length:", selectedEndpointsText.length);
  if (combinedRaw.length > MAX_TEXT_CHARS) {
    console.warn("[Analyze Route] Text was truncated! Some content may be lost.");
  }

  // 선택된 엔드포인트 개수를 프롬프트에 포함
  const endpointCount = selectedEndpoints.length;
  
  const prompt = `
너는 공공기관/정부 OPEN API 명세를 분석하여 정확한 "기관 레벨 api_profile" JSON을 생성하는 전문가다.
반드시 JSON만 출력한다(설명 텍스트 금지).

## ⚠️ 최우선 규칙: 데이터 완전성 보장
${endpointCount > 0 ? `
**사용자가 ${endpointCount}개의 엔드포인트를 선택했습니다.**

### 엔드포인트 규칙:
- 반드시 endpoints 배열에 **정확히 ${endpointCount}개**의 엔드포인트를 포함해야 합니다.
- 유사한 이름의 엔드포인트도 **절대 통합하지 말고** 각각 별도 항목으로 생성하세요.

### 파라미터/필드 규칙 (가장 중요):
- SELECTED_ENDPOINTS의 각 엔드포인트에 명시된 **모든 요청 파라미터**를 request_params에 포함하라.
- SELECTED_ENDPOINTS의 각 엔드포인트에 명시된 **모든 응답 필드**를 response_fields에 포함하라.
- **절대로 요약하거나 대표값만 선택하지 마라.** 전체 목록을 그대로 옮겨라.
- 예: "요청 파라미터 (8개)"라고 되어 있으면 request_params에 8개 전부 포함.
- 예: "응답 필드 (60개)"라고 되어 있으면 response_fields에 60개 전부 포함.
` : ''}

## 핵심 분석 규칙

### 1. 엔드포인트 경로 추출 (가장 중요)
- 가이드 문서에서 **실제 호출 URL 예시**를 찾아 정확한 path를 추출하라.
- 예시: "http://www.law.go.kr/DRF/lawSearch.do?OC=..." → path는 "/DRF/lawSearch.do"
- 예시: "https://api.data.go.kr/openapi/tn_pubr_public..." → path는 "/openapi/tn_pubr_public..."
- **절대로 /api/법령목록 같은 추상적인 경로를 만들지 마라.** 실제 URL에서 추출하라.
- path를 찾을 수 없으면 warnings에 "endpoint_path_uncertain"을 넣어라.

### 2. 인증 방식 자동 감지 (분기 처리)
가이드 문서에서 아래 패턴을 찾아 분기하라:

**Case A: OC(사용자ID)만 필요한 경우** (예: 국가법령정보센터)
- "OC", "사용자ID", "기관코드" 파라미터만 언급되고, authKey/ServiceKey가 없음
- → auth.type: "param", auth.param_name: "OC", auth.secret_ref: "ENV:SCRAPER_{ORG}_OC"
- → OC는 시크릿이 아니므로 default_params에도 넣을 수 있음

**Case B: authKey/ServiceKey만 필요한 경우** (예: 공공데이터포털 대부분)
- "authKey", "serviceKey", "apiKey", "인증키" 파라미터 언급
- → auth.type: "apiKey", auth.param_name: "ServiceKey" 또는 "authKey", auth.secret_ref: "ENV:SCRAPER_{ORG}_AUTHKEY"

**Case C: OC + authKey 둘 다 필요한 경우**
- 둘 다 언급되면 둘 다 설정
- → auth.type: "multi", auth.params: [{ name: "OC", secret_ref: "..." }, { name: "authKey", secret_ref: "..." }]

**Case D: 인증 정보를 찾을 수 없는 경우**
- → auth.type: "unknown", warnings에 "auth_method_uncertain" 추가

### 3. 필수 파라미터 및 기본값 추출 (매우 중요)
- 가이드에서 "필수", "Required", "*" 표시된 파라미터를 찾아라.
- 각 엔드포인트별로 required_params 배열에 넣어라.

**핵심: 엔드포인트별 고정 파라미터 값 추출**
- 각 API가 어떤 데이터를 조회하는지에 따라 **target 값이 고정**되는 경우가 많다.
- 예시:
  - "법령 목록 조회" → target=law (고정)
  - "행정규칙 목록 조회" → target=admrul (고정)
  - "판례 목록 조회" → target=prec (고정)
  - "자치법규 목록 조회" → target=ordin (고정)
- 이런 고정값은 **fixed_params** 필드에 넣어라.
- 사용자가 입력해야 하는 가변 파라미터(query, page, lawId 등)는 **variable_params**에 넣어라.

**target 값 추론 규칙**:
- "법령", "법률", "대통령령", "시행령" → target=law
- "행정규칙", "훈령", "예규", "고시" → target=admrul
- "판례", "대법원", "법원" → target=prec
- "헌재", "헌법재판소" → target=detc
- "자치법규", "조례", "규칙" → target=ordin
- "행정심판" → target=adjud

### 4. 응답 형식 감지
- 가이드에서 "XML", "JSON", "HTML" 언급을 찾아라.
- 대부분의 한국 공공 API는 **XML이 기본**이다.
- JSON 지원 여부가 불명확하면 format: "XML"로 설정하라.

### 5. base_url 정확히 추출
- 실제 API 호출 URL의 프로토콜(http/https)과 도메인을 정확히 추출하라.
- 예: "http://www.law.go.kr/DRF/..." → base_url: "http://www.law.go.kr"
- 가이드 페이지 URL과 API 호출 URL이 다를 수 있으니 주의하라.

### 6. 제약조건 추출
- "IP 등록", "IP 허용", "화이트리스트" → ip_allowlist_required: true
- "일 1000건", "호출 제한" → rate_limit_hint 설정
- "신청 필요", "승인 필요" → approval_required: true

### 7. 요청 파라미터 (request_params) - ⚠️ 절대 생략 금지
**SELECTED_ENDPOINTS에 이미 추출된 "요청 파라미터" 목록이 있으면, 해당 목록을 그대로 request_params 배열에 포함하라.**
- 절대로 요약하거나 일부만 선택하지 마라.
- 모든 파라미터를 빠짐없이 포함해야 한다.
- 형식:
  - name: 파라미터 영문명
  - name_ko: 파라미터 한글명 (있으면)
  - required: 필수 여부 (true/false)
  - type: 데이터 타입 (string, int, date 등)
  - description: 설명

### 8. 응답 필드 (response_fields) - ⚠️ 절대 생략 금지
**SELECTED_ENDPOINTS에 이미 추출된 "응답 필드" 목록이 있으면, 해당 목록을 그대로 response_fields 배열에 포함하라.**
- 절대로 요약하거나 일부만 선택하지 마라.
- 모든 필드를 빠짐없이 포함해야 한다.
- 60개의 필드가 있으면 60개 전부, 33개면 33개 전부 포함.
- 형식:
  - name: 필드명 (영문 또는 한글)
  - name_ko: 필드 한글명
  - type: 데이터 타입 (string, int, date 등)
  - description: 설명

**⚠️ 최종 검증**: 각 엔드포인트별로 입력된 파라미터/필드 개수와 출력된 개수가 일치하는지 확인하라.

## 출력 스키마

{
  "api_profile": {
    "organization": "기관명",
    "base_url": "http(s)://실제도메인",
    "guide_url": "가이드URL",
    "auth": {
      "type": "param|apiKey|multi|unknown",
      "param_name": "OC 또는 ServiceKey 등",
      "secret_ref": "ENV:SCRAPER_기관ID_파라미터명"
    },
    "endpoints": [
      {
        "name": "API명 (예: 현행법령 목록 조회)",
        "path": "/실제/경로.do",
        "method": "GET",
        "required_params": ["target", "type"],
        "fixed_params": {
          "target": "law",
          "type": "XML"
        },
        "variable_params": ["query", "page", "display"],
        "description": "설명",
        "request_params": [
          {
            "name": "OC",
            "name_ko": "사용자ID",
            "required": true,
            "type": "string",
            "description": "Open API 사용자 ID"
          },
          {
            "name": "target",
            "name_ko": "대상",
            "required": true,
            "type": "string",
            "description": "검색 대상 (law, admrul, prec 등)"
          }
        ],
        "response_fields": [
          {
            "name": "법령일련번호",
            "name_ko": "법령일련번호",
            "type": "string",
            "description": "법령 고유 식별자"
          },
          {
            "name": "법령명한글",
            "name_ko": "법령명한글",
            "type": "string",
            "description": "법령의 한글 명칭"
          },
          {
            "name": "공포일자",
            "name_ko": "공포일자",
            "type": "date",
            "description": "법령 공포 일자"
          }
        ]
      }
    ],
    "default_params": {
      "type": "XML"
    },
    "response_mapping": {
      "format": "XML",
      "list_xpath": "//item 또는 실제경로",
      "total_xpath": "//totalCount"
    },
    "constraints": {
      "ip_allowlist_required": true/false,
      "rate_limit_hint": "일 N건",
      "approval_required": true/false
    },
    "status": "draft"
  },
  "warnings": ["확실하지 않은 항목 목록"],
  "summary": "분석 요약 (한국어)"
}

## 입력 데이터

${combined}
  `.trim();

  try {
    console.log("[Analyze Route] Sending to LLM. Prompt length:", prompt.length);
    console.log("[Analyze Route] Prompt preview (first 500 chars of combined):", combined.substring(0, 500));
    
    // 엔드포인트가 3개 이상이면 개별 처리 후 병합
    if (selectedEndpoints.length >= 3) {
      console.log("[Analyze Route] Using batch processing for", selectedEndpoints.length, "endpoints");
      
      // 1. 먼저 기본 프로파일 생성 (엔드포인트 제외)
      const basePrompt = `
너는 공공기관/정부 OPEN API 명세를 분석하여 "기관 레벨 api_profile" JSON을 생성하는 전문가다.
반드시 JSON만 출력한다.

## 작업: 기본 프로파일 생성 (endpoints 제외)
다음 기관의 기본 API 프로파일을 생성하라. endpoints 배열은 빈 배열로 둔다.

ORG: ${org.org_name} (${org.org_id})
BASE_URL_HINT: ${org.base_url}
${url ? `GUIDE_URL: ${url}` : ""}

## 출력 형식
{
  "api_profile": {
    "organization": "기관명",
    "base_url": "http(s)://도메인",
    "guide_url": "가이드URL",
    "auth": { "type": "param", "param_name": "OC", "secret_ref": "ENV:SCRAPER_LAW_OC" },
    "endpoints": [],
    "default_params": { "type": "XML" },
    "response_mapping": { "format": "XML", "list_xpath": "//item", "total_xpath": "//totalCount" },
    "constraints": { "ip_allowlist_required": false, "rate_limit_hint": "", "approval_required": false },
    "status": "draft"
  },
  "warnings": [],
  "summary": ""
}
      `.trim();
      
      const baseResult = await llmChatJson<ApiProfileProposal>({
        provider, model_mode, model,
        messages: [
          { role: "system", content: "You extract API specs and return JSON only." },
          { role: "user", content: basePrompt },
        ],
      });
      
      console.log("[Analyze Route] Base profile created");
      
      // 2. 각 엔드포인트를 개별적으로 처리
      const processedEndpoints: any[] = [];
      
      for (let i = 0; i < selectedEndpoints.length; i++) {
        const ep = selectedEndpoints[i];
        console.log(`[Analyze Route] Processing endpoint ${i + 1}/${selectedEndpoints.length}: ${ep.title}`);
        
        const epPrompt = `
다음 API 엔드포인트 정보를 바탕으로 endpoint 객체 하나를 JSON으로 생성하라.
모든 request_params와 response_fields를 빠짐없이 포함해야 한다.

## 엔드포인트 정보
제목: ${ep.title}
카테고리: ${ep.category || ""}
요청URL: ${ep.request_url || ""}

요청 파라미터 (${ep.request_params?.length || 0}개):
${(ep.request_params || []).map((p: any) => `  - ${p.name}, 타입: ${p.type}, 필수: ${p.required}, 설명: ${p.description}`).join("\n")}

응답 필드 (${ep.response_fields?.length || 0}개):
${(ep.response_fields || []).map((f: any) => `  - ${f.name}, 타입: ${f.type}, 설명: ${f.description}`).join("\n")}

## 출력 형식 (이 형식 그대로 출력)
{
  "endpoint": {
    "name": "API명",
    "path": "/경로",
    "method": "GET",
    "required_params": [],
    "fixed_params": {},
    "variable_params": [],
    "description": "설명",
    "request_params": [ { "name": "", "name_ko": "", "required": true, "type": "", "description": "" } ],
    "response_fields": [ { "name": "", "name_ko": "", "type": "", "description": "" } ]
  }
}
        `.trim();
        
        try {
          const epResult = await llmChatJson<{ endpoint: any }>({
            provider, model_mode, model,
            messages: [
              { role: "system", content: "You extract API specs and return JSON only. Include ALL request_params and response_fields." },
              { role: "user", content: epPrompt },
            ],
          });
          
          if (epResult?.endpoint) {
            processedEndpoints.push(epResult.endpoint);
            console.log(`[Analyze Route] Endpoint ${i + 1} done: ${epResult.endpoint.request_params?.length || 0} params, ${epResult.endpoint.response_fields?.length || 0} fields`);
          }
        } catch (epError) {
          console.error(`[Analyze Route] Failed to process endpoint ${i + 1}:`, epError);
        }
      }
      
      // 3. 결과 병합
      const finalResult = baseResult;
      if (finalResult?.api_profile) {
        finalResult.api_profile.endpoints = processedEndpoints;
      }
      
      console.log("[Analyze Route] Batch processing complete. Total endpoints:", processedEndpoints.length);
      
      return NextResponse.json({
        ok: true,
        proposal: finalResult,
      });
    }
    
    // 엔드포인트가 2개 이하면 기존 방식 사용
    const result = await llmChatJson<ApiProfileProposal>({
      provider,
      model_mode,
      model,
      messages: [
        { role: "system", content: "You extract API specs and return JSON only." },
        { role: "user", content: prompt },
      ],
    });
    
    console.log("[Analyze Route] LLM result endpoints count:", (result as any)?.api_profile?.endpoints?.length);

    return NextResponse.json({
      ok: true,
      proposal: result,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "analyze_failed");
    // 키 미설정 등은 400으로 내려 UI에서 바로 안내
    if (msg.startsWith("llm_not_configured")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
