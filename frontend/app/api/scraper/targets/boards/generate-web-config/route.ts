import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 최신 모델 자동 선택을 위한 환경변수 (없으면 최신 기본값 사용)
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

interface CollectionTargets {
  title_body?: boolean;
  attachments?: {
    enabled?: boolean;
    all?: boolean;
    hwpx?: boolean;
    docx?: boolean;
    xlsx?: boolean;
    pdf?: boolean;
  };
}

interface CollectionRange {
  type: "period" | "relative" | "yearly" | "";
  period_start?: string;
  period_end?: string;
  relative_days?: number;
  years?: number[];
}

interface SiteStructure {
  board_type?: string;
  rendering?: string;
  list?: {
    container_selector?: string;
    item_selector?: string;
    title_selector?: string;
    date_selector?: string;
    link_selector?: string;
    author_selector?: string;
  };
  pagination?: {
    type?: string;
    param?: string;
    selector?: string;
    start?: number;           // 시작 값 (0 또는 1)
    step?: number;            // offset_param용 증가값
    max_pages?: number;       // 최대 페이지 수
    onclick_pattern?: string; // javascript 타입용 패턴
    detected_method?: string; // 감지 방법 설명 (표시용)
  };
  detail?: {
    content_selector?: string;
    attachments_selector?: string;
  };
  attachment_config?: {
    pattern_type?: string;
    container_selector?: string;
    link_selector?: string;
    download_url_pattern?: string;  // 다운로드 URL 패턴 (예: /file/download/{fileId}/{fileKey})
    onclick_function?: string;
  };
}

// site_structure를 web_config로 변환
function convertSiteStructureToWebConfig(
  siteStructure: SiteStructure,
  collectionTargets?: CollectionTargets,
  collectionRange?: CollectionRange
): Record<string, unknown> {
  const webConfig: Record<string, unknown> = {
    rendering: siteStructure.rendering || "static_html",
  };

  // list 설정
  if (siteStructure.list) {
    webConfig.list = {
      item_selector: siteStructure.list.item_selector || "",
      container_selector: siteStructure.list.container_selector,
      pagination: siteStructure.pagination || { type: "none" },
    };
  }

  // parse_rules 설정
  if (siteStructure.list) {
    webConfig.parse_rules = {
      title: siteStructure.list.title_selector || "",
      date: siteStructure.list.date_selector || "",
      link: siteStructure.list.link_selector || "",
    };
    if (siteStructure.list.author_selector) {
      (webConfig.parse_rules as Record<string, string>).author = siteStructure.list.author_selector;
    }
  }

  // detail 설정 (본문 수집)
  if (collectionTargets?.title_body) {
    webConfig.detail = siteStructure.detail || {
      content_selector: "article, .content, .view_content, #content",
      title_selector: "h1, .title, .view_title",
    };
    webConfig.collect_body = true;
  } else {
    webConfig.collect_body = false;
  }

  // 수집 범위 설정
  if (collectionRange && collectionRange.type) {
    const rangeConfig: Record<string, unknown> = {
      type: collectionRange.type,
    };
    
    if (collectionRange.type === "period") {
      rangeConfig.start_date = collectionRange.period_start || null;
      rangeConfig.end_date = collectionRange.period_end || null;
    } else if (collectionRange.type === "relative") {
      rangeConfig.days_before = collectionRange.relative_days || 30;
    } else if (collectionRange.type === "yearly") {
      rangeConfig.years = collectionRange.years || [];
    }
    
    webConfig.collection_range = rangeConfig;
  }

  // attachments 설정
  if (collectionTargets?.attachments?.enabled) {
    const fileTypes: string[] = [];
    if (!collectionTargets.attachments.all) {
      if (collectionTargets.attachments.hwpx) fileTypes.push("hwpx", "hwp");
      if (collectionTargets.attachments.docx) fileTypes.push("docx", "doc");
      if (collectionTargets.attachments.xlsx) fileTypes.push("xlsx", "xls", "csv");
      if (collectionTargets.attachments.pdf) fileTypes.push("pdf");
    }
    
    // 첨부파일 선택자 결정 (우선순위: attachment_config > detail > 기본값)
    const attachmentSelector = 
      siteStructure.attachment_config?.link_selector ||
      siteStructure.detail?.attachments_selector || 
      "a[href*='.hwp'], a[href*='.pdf'], a[href*='.doc'], a[href*='.xls'], a[href*='download'], a[href*='fileDown']";
    
    webConfig.attachments = {
      enabled: true,
      collect_all: collectionTargets.attachments.all || false,
      file_types: fileTypes.length > 0 ? fileTypes : undefined,
      selector: attachmentSelector,
      // DOM 분석에서 감지된 다운로드 URL 패턴 적용
      download_url_pattern: siteStructure.attachment_config?.download_url_pattern,
    };
  } else {
    webConfig.attachments = {
      enabled: false,
    };
  }

  return webConfig;
}

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const html = await res.text();
    return html.slice(0, 50000);
  } catch (err: any) {
    throw new Error(`URL 접근 실패: ${err.message}`);
  }
}

// HTML에서 클래스명 추출
function extractClassNames(html: string): string[] {
  const classPattern = /class=["']([^"']+)["']/gi;
  const classes = new Set<string>();
  let match;
  while ((match = classPattern.exec(html)) !== null) {
    match[1].split(/\s+/).forEach(c => {
      if (c && c.length > 1 && c.length < 50) {
        classes.add(c);
      }
    });
  }
  return Array.from(classes).slice(0, 100);
}

async function refineWithOpenAI(
  currentConfig: string,
  refinePrompt: string,
  htmlContent: string
): Promise<Record<string, unknown>> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  // HTML에서 실제 클래스명 추출
  const existingClasses = extractClassNames(htmlContent);

  const systemPrompt = `당신은 10년 경력의 웹 스크래핑 전문가입니다. 정합성 테스트에서 실패한 CSS 선택자를 수정해야 합니다.

## ⚠️ 핵심 원칙
1. **HTML에 실제 존재하는 클래스/ID/태그만 사용**
2. **헤더, 네비게이션, 푸터는 제외** - 게시판 본문 영역만
3. **선택자를 더 구체적으로** - 태그+클래스 조합 사용

## 📊 HTML에서 발견된 클래스 (이것들만 사용하세요!)
${existingClasses.join(", ")}

## 🔧 선택자 수정 가이드
- "요소를 찾을 수 없음" → 클래스명이 틀렸거나 없음 → HTML에서 확인 후 수정
- "너무 많은 요소" → 선택자가 너무 일반적 → 더 구체적으로 (예: a → .board_list a)
- "잘못된 데이터" → 다른 영역 선택됨 → 게시판 영역으로 한정

## 📋 출력 형식
- 반드시 JSON만 출력 (설명 텍스트 없이)
- 기존 구조 유지하면서 선택자만 수정`;

  const userPrompt = `## 현재 web_config (수정 필요)
\`\`\`json
${currentConfig}
\`\`\`

## 오류 내용 및 수정 요청
${refinePrompt}

## HTML (게시판 영역)
\`\`\`html
${htmlContent.slice(0, 25000)}
\`\`\`

위 오류를 해결한 수정된 web_config JSON을 출력하세요. 선택자는 반드시 위 HTML에 존재하는 클래스/태그를 사용하세요.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API 오류: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";

  let jsonStr = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM 응답을 JSON으로 파싱할 수 없습니다: ${content.slice(0, 200)}`);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const {
      list_url,
      collection_targets,
      collection_range,
      site_structure,
      refine_prompt,
      current_config,
      access_mode,
    } = body;

    if (!list_url || typeof list_url !== "string") {
      return NextResponse.json({ error: "list_url이 필요합니다." }, { status: 400 });
    }

    // access_mode를 rendering 값으로 변환
    const renderingMode = access_mode === "dynamic_js" ? "dynamic_js" : 
                          access_mode === "login_required" ? "dynamic_js" :
                          access_mode === "static_html" ? "static_html" : "static_html";

    let webConfig: Record<string, unknown>;

    // Case 1: 수정 요청이 있는 경우 - LLM으로 수정
    if (refine_prompt && current_config) {
      const htmlContent = await fetchUrlContent(list_url);
      webConfig = await refineWithOpenAI(current_config, refine_prompt, htmlContent);
      
      // LLM 수정 후에도 collection_range와 collection_targets는 유지
      if (collection_range && collection_range.type) {
        const rangeConfig: Record<string, unknown> = { type: collection_range.type };
        if (collection_range.type === "period") {
          rangeConfig.start_date = collection_range.period_start || null;
          rangeConfig.end_date = collection_range.period_end || null;
        } else if (collection_range.type === "relative") {
          rangeConfig.days_before = collection_range.relative_days || 30;
        } else if (collection_range.type === "yearly") {
          rangeConfig.years = collection_range.years || [];
        }
        webConfig.collection_range = rangeConfig;
      }
      
      if (collection_targets?.title_body !== undefined) {
        webConfig.collect_body = collection_targets.title_body;
      }
      
      // access_mode에 따른 rendering 적용
      webConfig.rendering = renderingMode;
    }
    // Case 2: site_structure가 있는 경우 - 직접 변환 (LLM 호출 없음)
    else if (site_structure) {
      // access_mode가 전달되면 항상 우선 사용, 없으면 site_structure.rendering 사용
      const structureWithRendering = {
        ...site_structure,
        rendering: access_mode ? renderingMode : (site_structure.rendering || "static_html"),
      };
      webConfig = convertSiteStructureToWebConfig(structureWithRendering, collection_targets, collection_range);
    }
    // Case 3: site_structure가 없는 경우 - 에러
    else {
      return NextResponse.json(
        { error: "site_structure가 필요합니다. 먼저 'DOM 분석'을 실행해주세요." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      web_config: webConfig,
    });
  } catch (err: any) {
    console.error("[generate-web-config] Error:", err);
    return NextResponse.json(
      { error: err.message || "config 생성 실패" },
      { status: 500 }
    );
  }
}
