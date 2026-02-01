import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// 사이트 내 검색 옵션 타입 정의
interface SiteSearchOption {
  type: "select" | "text" | "date" | "radio" | "checkbox";
  name: string;           // input name 또는 select name
  label: string;          // 레이블 텍스트
  selector: string;       // CSS 선택자
  options?: { value: string; label: string }[];  // select, radio, checkbox용 옵션들
  placeholder?: string;   // text input용 플레이스홀더
  default_value?: string; // 기본값
}

interface SiteSearchConfig {
  form_selector?: string;       // 검색 폼 선택자
  submit_selector?: string;     // 검색 버튼 선택자
  submit_type: "form" | "url_param" | "ajax";  // 검색 제출 방식
  options: SiteSearchOption[];  // 검색 옵션들
}

// 첨부파일 감지 패턴 유형
type AttachmentPatternType = 
  | "standard_href"           // 표준 href 기반
  | "onclick_fndownload"      // 국민참여입법센터 패턴
  | "onclick_javascript"      // onclick="javascript:..." 패턴
  | "file_area_button"        // 파일 영역 내 버튼 클릭
  | "ajax"                    // AJAX 기반 첨부파일 조회
  | "auto";                   // 자동 감지

interface AttachmentConfig {
  pattern_type: AttachmentPatternType;
  container_selector?: string;
  link_selector?: string;
  filename_selector?: string;
  onclick_function?: string;
  download_url_pattern?: string;
  ajax_endpoint?: string;     // AJAX 엔드포인트
}

// 페이지네이션 설정 타입
interface PaginationConfig {
  type: "page_param" | "offset_param" | "next_button" | "javascript" | "none";
  param?: string;          // 페이지 파라미터 이름 (page, pageIndex, pageNo 등)
  selector?: string;       // next_button용 선택자
  start?: number;          // 시작 값 (0 또는 1)
  step?: number;           // offset_param용 증가값
  max_pages?: number;      // 최대 페이지 수
  onclick_pattern?: string; // javascript 타입용 패턴
  detected_method?: string; // 감지된 방법 설명
}

interface DomAnalysisResult {
  success: boolean;
  board_type: "table" | "list" | "div" | "unknown";
  rendering: "static_html" | "dynamic_js";
  list: {
    container_selector: string;
    item_selector: string;
    item_count: number;
    title_selector: string;
    date_selector: string;
    link_selector: string;
    author_selector: string | null;
  };
  pagination: PaginationConfig;
  samples: {
    titles: string[];
    dates: string[];
    links: string[];
  };
  published_date_rule: {
    source: string;
    selector: string;
    format: string;
  };
  site_search_config?: SiteSearchConfig;  // 사이트 내 검색 옵션
  attachment_config?: AttachmentConfig;   // 첨부파일 감지 패턴
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      },
      signal: AbortSignal.timeout(45000), // 45초로 증가
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch (err: any) {
    // 타임아웃 에러에 대한 친절한 메시지
    if (err?.name === "TimeoutError" || err?.code === 23) {
      throw new Error("사이트 응답 시간 초과. 사이트가 느리거나 접근이 차단되었을 수 있습니다. '동적 JS' 렌더링 모드를 시도해보세요.");
    }
    throw err;
  }
}

function detectDateFormat(dateStr: string): string {
  if (/\d{4}-\d{2}-\d{2}/.test(dateStr)) return "YYYY-MM-DD";
  if (/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*[~\-]/.test(dateStr)) return "YYYY. MM. DD. ~ YYYY. MM. DD.";  // 날짜 범위
  if (/\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/.test(dateStr)) return "YYYY. MM. DD.";  // 공백 포함
  if (/\d{4}\.\d{2}\.\d{2}/.test(dateStr)) return "YYYY.MM.DD";
  if (/\d{4}\/\d{2}\/\d{2}/.test(dateStr)) return "YYYY/MM/DD";
  if (/\d{2}-\d{2}-\d{2}/.test(dateStr)) return "YY-MM-DD";
  if (/\d{2}\.\d{2}\.\d{2}/.test(dateStr)) return "YY.MM.DD";
  if (/\d{4}년/.test(dateStr)) return "YYYY년 MM월 DD일";
  return "unknown";
}

/**
 * 링크 요소에서 실제 URL을 추출 (href 또는 onclick에서)
 * onclick 속성에서 다양한 패턴의 URL을 추출합니다.
 */
function extractLinkUrl($el: cheerio.Cheerio<cheerio.Element>, baseUrl: string): string {
  const href = $el.attr("href") || "";
  const onclick = $el.attr("onclick") || "";
  
  // 1. href가 유효한 URL이면 그대로 사용
  if (href && !href.startsWith("javascript:") && !href.startsWith("#") && href !== "void(0)") {
    // 상대 경로를 절대 경로로 변환
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  }
  
  // 2. onclick에서 URL 추출 시도
  if (onclick) {
    // location.href = 'url' 패턴
    const locationMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
    if (locationMatch) {
      try {
        return new URL(locationMatch[1], baseUrl).href;
      } catch {
        return locationMatch[1];
      }
    }
    
    // fn_view('id'), goView('id'), boardView('id') 등의 함수 호출 패턴
    // 이 경우 View.do?seq=id 형태로 변환
    const viewFnMatch = onclick.match(/(?:fn_view|goView|boardView|viewDetail|fnView|fn_detail)\s*\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    if (viewFnMatch) {
      const id = viewFnMatch[1];
      // 목록 URL에서 View.do 패턴 추출
      try {
        const urlObj = new URL(baseUrl);
        // boardList.do -> boardView.do 변환
        const viewPath = urlObj.pathname.replace(/List\.do$/i, "View.do");
        urlObj.pathname = viewPath;
        urlObj.searchParams.set("seq", id);
        return urlObj.href;
      } catch {
        return "";
      }
    }
    
    // goPage(pageNo, id) 패턴 - 두 번째 인자가 ID일 때
    const goPageMatch = onclick.match(/goPage\s*\(\s*\d+\s*,\s*['"]?([^'",)]+)['"]?\s*\)/i);
    if (goPageMatch) {
      try {
        const urlObj = new URL(baseUrl);
        const viewPath = urlObj.pathname.replace(/List\.do$/i, "View.do");
        urlObj.pathname = viewPath;
        urlObj.searchParams.set("seq", goPageMatch[1]);
        return urlObj.href;
      } catch {
        return "";
      }
    }
    
    // 직접 URL이 포함된 패턴 (window.open, location.replace 등)
    const urlMatch = onclick.match(/(?:open|replace)\s*\(\s*['"]([^'"]+)['"]/);
    if (urlMatch) {
      try {
        return new URL(urlMatch[1], baseUrl).href;
      } catch {
        return urlMatch[1];
      }
    }
  }
  
  return "";
}

/**
 * 페이지네이션 분석 함수 - 다양한 페이지네이션 패턴을 감지
 */
function analyzePagination($: cheerio.CheerioAPI, pageUrl: string): PaginationConfig {
  // 1. 페이지네이션 컨테이너 찾기 (다양한 선택자 시도)
  const paginationSelectors = [
    // 클래스 기반
    ".pagination", ".paging", ".page_wrap", ".page_num", ".paginate",
    ".page-navigation", ".page_navigation", ".pageNavigation",
    ".board_paging", ".bbs_paging", ".list_paging",
    ".pagingWrap", ".paging_wrap", ".page-area", ".page_area",
    // ID 기반
    "#pagination", "#paging", "#pageNav",
    // aria 속성
    "nav[aria-label*='page']", "nav[aria-label*='pagination']",
    // 일반 구조
    "div.paging", "div.page", "ul.paging", "ul.page",
    // 한국 정부 사이트 패턴
    ".boardNaviWrap", ".pagingBox", ".pager",
  ];
  
  let $paging: cheerio.Cheerio<cheerio.Element> | null = null;
  for (const selector of paginationSelectors) {
    const $found = $(selector);
    if ($found.length > 0) {
      $paging = $found.first();
      break;
    }
  }
  
  // 페이지네이션 컨테이너를 못 찾으면 전체 문서에서 페이지 링크 패턴 검색
  if (!$paging) {
    // 숫자 링크가 여러 개 모여있는 영역 찾기
    const $allLinks = $("a");
    const pagePatternLinks: cheerio.Element[] = [];
    
    $allLinks.each((_, el) => {
      const href = $(el).attr("href") || "";
      const onclick = $(el).attr("onclick") || "";
      const text = $(el).text().trim();
      
      // 페이지 관련 패턴 감지
      if (
        /[?&](page|pageIndex|pageNo|p|cPage|currentPage|pageNum|nPage)[=&]/i.test(href) ||
        /[?&](offset|start|skip|begin)[=&]/i.test(href) ||
        /goPage|movePage|fnPage|pageMove|setPage/i.test(onclick) ||
        (/^\d+$/.test(text) && parseInt(text) <= 100)
      ) {
        pagePatternLinks.push(el);
      }
    });
    
    if (pagePatternLinks.length >= 3) {
      // 부모 요소를 페이지네이션 컨테이너로 사용
      $paging = $(pagePatternLinks[0]).parent();
    }
  }
  
  if (!$paging || $paging.length === 0) {
    return { type: "none", detected_method: "페이지네이션 영역을 찾을 수 없음" };
  }
  
  // 2. 페이지 링크들 분석
  const $pageLinks = $paging.find("a");
  const linkAnalysis: Array<{
    text: string;
    href: string;
    onclick: string;
    pageNum?: number;
    param?: string;
    value?: string | number;
  }> = [];
  
  $pageLinks.each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const href = $el.attr("href") || "";
    const onclick = $el.attr("onclick") || "";
    
    const analysis: typeof linkAnalysis[0] = { text, href, onclick };
    
    // 숫자 텍스트인 경우 페이지 번호로 추정
    if (/^\d+$/.test(text)) {
      analysis.pageNum = parseInt(text);
    }
    
    // href에서 페이지 파라미터 추출
    const pageParamPatterns = [
      /[?&](page)=(\d+)/i,
      /[?&](pageIndex)=(\d+)/i,
      /[?&](pageNo)=(\d+)/i,
      /[?&](p)=(\d+)/i,
      /[?&](cPage)=(\d+)/i,
      /[?&](currentPage)=(\d+)/i,
      /[?&](pageNum)=(\d+)/i,
      /[?&](nPage)=(\d+)/i,
      /[?&](pg)=(\d+)/i,
    ];
    
    for (const pattern of pageParamPatterns) {
      const match = href.match(pattern);
      if (match) {
        analysis.param = match[1];
        analysis.value = parseInt(match[2]);
        break;
      }
    }
    
    // 오프셋 파라미터 추출
    if (!analysis.param) {
      const offsetPatterns = [
        /[?&](offset)=(\d+)/i,
        /[?&](start)=(\d+)/i,
        /[?&](skip)=(\d+)/i,
        /[?&](begin)=(\d+)/i,
        /[?&](firstIndex)=(\d+)/i,
      ];
      
      for (const pattern of offsetPatterns) {
        const match = href.match(pattern);
        if (match) {
          analysis.param = match[1];
          analysis.value = parseInt(match[2]);
          break;
        }
      }
    }
    
    // onclick에서 함수 패턴 추출
    if (!analysis.param && onclick) {
      const onclickPatterns = [
        /goPage\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /movePage\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /fnPage\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /pageMove\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /setPage\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /fn_search\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /searchList\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
        /goList\s*\(\s*['"]?(\d+)['"]?\s*\)/i,
      ];
      
      for (const pattern of onclickPatterns) {
        const match = onclick.match(pattern);
        if (match) {
          analysis.value = parseInt(match[1]);
          break;
        }
      }
    }
    
    linkAnalysis.push(analysis);
  });
  
  // 3. 분석 결과로 페이지네이션 타입 결정
  
  // 3-1. 페이지 파라미터 기반 감지
  const paramLinks = linkAnalysis.filter(l => l.param && typeof l.value === "number");
  if (paramLinks.length >= 2) {
    const paramName = paramLinks[0].param!;
    const values = paramLinks.map(l => l.value as number).sort((a, b) => a - b);
    
    // 오프셋 기반인지 페이지 기반인지 판단
    const diffs = values.slice(1).map((v, i) => v - values[i]);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    
    // offset/start/skip/begin 파라미터이거나 증가값이 10 이상이면 오프셋 기반
    if (/offset|start|skip|begin|firstIndex/i.test(paramName) || avgDiff >= 10) {
      return {
        type: "offset_param",
        param: paramName,
        start: values[0],
        step: Math.round(avgDiff),
        max_pages: Math.max(...values.filter(v => !isNaN(v))) / Math.round(avgDiff) + 1,
        detected_method: `오프셋 파라미터 "${paramName}" 감지 (증가값: ${Math.round(avgDiff)})`,
      };
    } else {
      // 페이지 파라미터 기반
      return {
        type: "page_param",
        param: paramName,
        start: Math.min(...values),
        max_pages: Math.max(...values),
        detected_method: `페이지 파라미터 "${paramName}" 감지 (시작: ${Math.min(...values)})`,
      };
    }
  }
  
  // 3-2. JavaScript onclick 기반 감지
  const onclickLinks = linkAnalysis.filter(l => l.onclick && typeof l.value === "number");
  if (onclickLinks.length >= 2) {
    const values = onclickLinks.map(l => l.value as number).sort((a, b) => a - b);
    const onclick = onclickLinks[0].onclick;
    
    // onclick 패턴 추출
    const funcMatch = onclick.match(/(goPage|movePage|fnPage|pageMove|setPage|fn_search|searchList|goList)\s*\(/i);
    const funcName = funcMatch ? funcMatch[1] : "unknown";
    
    return {
      type: "javascript",
      start: Math.min(...values),
      max_pages: Math.max(...values),
      onclick_pattern: funcName,
      detected_method: `JavaScript 함수 "${funcName}" 기반 페이지네이션 감지`,
    };
  }
  
  // 3-3. 다음 버튼 기반 감지
  const nextButtonSelectors = [
    "a:contains('다음')", "a:contains('Next')", "a:contains('>')",
    "a.next", "a.btn_next", "a.page_next",
    "a[title*='다음']", "a[title*='Next']",
    "button:contains('다음')", "button.next",
    ".next a", ".btn-next a",
  ];
  
  for (const selector of nextButtonSelectors) {
    try {
      const $nextBtn = $paging.find(selector).first();
      if ($nextBtn.length > 0) {
        const href = $nextBtn.attr("href") || "";
        const onclick = $nextBtn.attr("onclick") || "";
        
        // href에서 파라미터 추출 시도
        if (href && href !== "#" && !href.startsWith("javascript:")) {
          const paramMatch = href.match(/[?&](page|pageIndex|pageNo|p)=(\d+)/i);
          if (paramMatch) {
            return {
              type: "page_param",
              param: paramMatch[1],
              start: 1,
              detected_method: `다음 버튼 href에서 "${paramMatch[1]}" 파라미터 감지`,
            };
          }
        }
        
        // onclick이 있으면 JavaScript 기반
        if (onclick) {
          return {
            type: "javascript",
            start: 1,
            onclick_pattern: onclick.match(/(\w+)\s*\(/)?.[1] || "onclick",
            detected_method: "다음 버튼 onclick 기반 페이지네이션 감지",
          };
        }
        
        return {
          type: "next_button",
          selector: buildSelector($, $nextBtn[0]),
          detected_method: "다음 버튼 기반 페이지네이션 감지",
        };
      }
    } catch {
      // 선택자 오류 무시
    }
  }
  
  // 3-4. URL 쿼리 파라미터에서 기존 페이지 파라미터 감지
  try {
    const url = new URL(pageUrl);
    const pageParams = ["page", "pageIndex", "pageNo", "p", "cPage", "currentPage", "pageNum"];
    
    for (const param of pageParams) {
      if (url.searchParams.has(param)) {
        return {
          type: "page_param",
          param: param,
          start: parseInt(url.searchParams.get(param) || "1") || 1,
          detected_method: `현재 URL에서 "${param}" 파라미터 감지`,
        };
      }
    }
    
    const offsetParams = ["offset", "start", "skip", "begin", "firstIndex"];
    for (const param of offsetParams) {
      if (url.searchParams.has(param)) {
        return {
          type: "offset_param",
          param: param,
          start: parseInt(url.searchParams.get(param) || "0") || 0,
          step: 10, // 기본값
          detected_method: `현재 URL에서 "${param}" 파라미터 감지`,
        };
      }
    }
  } catch {
    // URL 파싱 실패 무시
  }
  
  // 3-5. 페이지네이션 영역은 있지만 패턴을 파악 못한 경우
  if ($paging && $pageLinks.length > 0) {
    return {
      type: "page_param",
      param: "page",
      start: 1,
      detected_method: "페이지네이션 영역 발견, 기본 page 파라미터 사용 (수동 확인 필요)",
    };
  }
  
  return { type: "none", detected_method: "페이지네이션을 감지하지 못함" };
}

function isDateLike(text: string): boolean {
  const datePatterns = [
    /\d{4}-\d{2}-\d{2}/,
    /\d{4}\.\d{2}\.\d{2}/,
    /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?/,  // "2025. 12. 24." 형식 (공백 포함)
    /\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?\s*[~\-]\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?/, // 날짜 범위
    /\d{4}\/\d{2}\/\d{2}/,
    /\d{2}-\d{2}-\d{2}/,
    /\d{2}\.\d{2}\.\d{2}/,
    /\d{4}년\s*\d{1,2}월/,
  ];
  return datePatterns.some(p => p.test(text));
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 사이트 내 검색 옵션 감지 함수
 * - select 드롭다운 (소관부처, 법령종류 등)
 * - text input (키워드 검색)
 * - date input (날짜 범위)
 * - radio/checkbox (필터 옵션)
 */
function detectSiteSearchOptions($: cheerio.CheerioAPI): SiteSearchConfig | null {
  const options: SiteSearchOption[] = [];
  let formSelector: string | undefined;
  let submitSelector: string | undefined;
  let submitType: "form" | "url_param" | "ajax" = "url_param";
  
  // 검색 관련 폼 찾기 (검색, 조회, 필터 등 관련 영역)
  const searchForms = $("form").filter((_, form) => {
    const $form = $(form);
    const formClass = ($form.attr("class") || "").toLowerCase();
    const formId = ($form.attr("id") || "").toLowerCase();
    const formAction = ($form.attr("action") || "").toLowerCase();
    
    // 로그인 폼 제외
    if (formAction.includes("login") || formId.includes("login") || formClass.includes("login")) {
      return false;
    }
    
    // 검색 관련 키워드 확인
    const hasSearchKeyword = 
      formClass.includes("search") || formId.includes("search") ||
      formClass.includes("srch") || formId.includes("srch") ||
      formClass.includes("filter") || formId.includes("filter") ||
      formClass.includes("조회") || formId.includes("조회");
    
    // 검색 관련 input/select가 있는지 확인
    const hasSearchInput = $form.find("input[type='text'], input[type='search'], select").length > 0;
    
    return hasSearchKeyword || hasSearchInput;
  });
  
  // 검색 영역 식별 (폼 또는 div)
  let $searchArea = searchForms.first();
  
  if ($searchArea.length === 0) {
    // 폼이 없으면 검색 관련 div 영역 찾기
    const searchDivs = $("div, section, fieldset").filter((_, el) => {
      const $el = $(el);
      const elClass = ($el.attr("class") || "").toLowerCase();
      const elId = ($el.attr("id") || "").toLowerCase();
      
      return (
        elClass.includes("search") || elId.includes("search") ||
        elClass.includes("srch") || elId.includes("srch") ||
        elClass.includes("filter") || elId.includes("filter") ||
        elClass.includes("조회") || elId.includes("조회") ||
        elClass.includes("검색") || elId.includes("검색")
      );
    });
    
    $searchArea = searchDivs.first();
    submitType = "url_param";
  } else {
    submitType = "form";
    formSelector = buildSelector($, $searchArea[0]);
  }
  
  if ($searchArea.length === 0) {
    // 그래도 없으면 전체 페이지에서 검색 요소 찾기
    $searchArea = $("body");
  }
  
  // Select 드롭다운 분석
  $searchArea.find("select").each((_, select) => {
    const $select = $(select);
    const name = $select.attr("name") || $select.attr("id") || "";
    
    // 숨김 처리된 것 제외
    if ($select.css("display") === "none" || $select.attr("type") === "hidden") return;
    
    // 페이지 크기 선택 등 제외
    const lowerName = name.toLowerCase();
    if (lowerName.includes("pagesize") || lowerName.includes("perpage") || lowerName.includes("display")) return;
    
    // 레이블 찾기
    let label = "";
    const labelEl = $(`label[for="${$select.attr("id")}"]`);
    if (labelEl.length > 0) {
      label = cleanText(labelEl.text());
    } else {
      // 인접한 레이블 또는 이전 sibling 확인
      const $prev = $select.prev("label, span, th, dt");
      if ($prev.length > 0) {
        label = cleanText($prev.text());
      } else {
        // 부모에서 레이블 찾기
        const $parent = $select.parent();
        const parentText = $parent.clone().children().remove().end().text();
        if (parentText.trim()) {
          label = cleanText(parentText);
        }
      }
    }
    
    // 옵션들 추출
    const selectOptions: { value: string; label: string }[] = [];
    $select.find("option").each((_, opt) => {
      const $opt = $(opt);
      const value = $opt.attr("value") || "";
      const optLabel = cleanText($opt.text());
      if (optLabel && value !== "") {  // 빈 값 옵션은 "전체" 등일 수 있으므로 일단 포함
        selectOptions.push({ value, label: optLabel });
      } else if (optLabel && value === "") {
        selectOptions.push({ value: "", label: optLabel });
      }
    });
    
    if (selectOptions.length > 1) {  // 최소 2개 이상의 옵션이 있어야 의미 있음
      options.push({
        type: "select",
        name,
        label: label || name,
        selector: buildSelector($, select),
        options: selectOptions,
        default_value: $select.val()?.toString() || "",
      });
    }
  });
  
  // Text input 분석 (검색 키워드 입력)
  $searchArea.find("input[type='text'], input[type='search'], input:not([type])").each((_, input) => {
    const $input = $(input);
    const name = $input.attr("name") || $input.attr("id") || "";
    const type = $input.attr("type") || "text";
    
    // 숨김 처리된 것 제외
    if ($input.css("display") === "none" || type === "hidden") return;
    
    // 페이지 관련 input 제외
    const lowerName = name.toLowerCase();
    if (lowerName.includes("page") && !lowerName.includes("search")) return;
    
    // 레이블 찾기
    let label = "";
    const labelEl = $(`label[for="${$input.attr("id")}"]`);
    if (labelEl.length > 0) {
      label = cleanText(labelEl.text());
    } else {
      const $prev = $input.prev("label, span, th, dt");
      if ($prev.length > 0) {
        label = cleanText($prev.text());
      }
    }
    
    const placeholder = $input.attr("placeholder") || "";
    
    // 검색어 관련 input인지 판단
    const isSearchInput = 
      lowerName.includes("search") || lowerName.includes("query") ||
      lowerName.includes("keyword") || lowerName.includes("srch") ||
      lowerName.includes("검색") || lowerName.includes("제명") ||
      placeholder.toLowerCase().includes("검색") ||
      placeholder.toLowerCase().includes("search");
    
    if (name || isSearchInput) {
      options.push({
        type: "text",
        name: name || "search",
        label: label || placeholder || "검색어",
        selector: buildSelector($, input),
        placeholder,
      });
    }
  });
  
  // Date input 분석
  $searchArea.find("input[type='date'], input[name*='date'], input[name*='Date'], input[id*='date'], input[id*='Date']").each((_, input) => {
    const $input = $(input);
    const name = $input.attr("name") || $input.attr("id") || "";
    
    if ($input.css("display") === "none") return;
    
    let label = "";
    const labelEl = $(`label[for="${$input.attr("id")}"]`);
    if (labelEl.length > 0) {
      label = cleanText(labelEl.text());
    } else {
      const $prev = $input.prev("label, span, th, dt");
      if ($prev.length > 0) {
        label = cleanText($prev.text());
      }
    }
    
    options.push({
      type: "date",
      name,
      label: label || "날짜",
      selector: buildSelector($, input),
      placeholder: $input.attr("placeholder") || "",
    });
  });
  
  // Radio 버튼 그룹 분석
  const radioGroups: Record<string, cheerio.Element[]> = {};
  $searchArea.find("input[type='radio']").each((_, radio) => {
    const name = $(radio).attr("name") || "";
    if (name) {
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(radio);
    }
  });
  
  for (const [name, radios] of Object.entries(radioGroups)) {
    const radioOptions: { value: string; label: string }[] = [];
    let groupLabel = "";
    
    radios.forEach((radio) => {
      const $radio = $(radio);
      const value = $radio.attr("value") || "";
      
      // 라디오 버튼의 레이블 찾기
      let optLabel = "";
      const labelEl = $(`label[for="${$radio.attr("id")}"]`);
      if (labelEl.length > 0) {
        optLabel = cleanText(labelEl.text());
      } else {
        // 다음 텍스트 노드 확인
        const nextText = $radio[0].nextSibling;
        if (nextText && nextText.nodeType === 3) {
          optLabel = cleanText(nextText.nodeValue || "");
        }
      }
      
      if (optLabel || value) {
        radioOptions.push({ value, label: optLabel || value });
      }
    });
    
    // 그룹 레이블 찾기
    const $firstRadio = $(radios[0]);
    const $fieldset = $firstRadio.closest("fieldset");
    if ($fieldset.length > 0) {
      const $legend = $fieldset.find("legend");
      if ($legend.length > 0) {
        groupLabel = cleanText($legend.text());
      }
    }
    
    if (radioOptions.length > 1) {
      options.push({
        type: "radio",
        name,
        label: groupLabel || name,
        selector: `input[name="${name}"]`,
        options: radioOptions,
      });
    }
  }
  
  // 검색 버튼 찾기
  const $submitBtn = $searchArea.find("button[type='submit'], input[type='submit'], button:contains('검색'), button:contains('조회'), a:contains('검색')").first();
  if ($submitBtn.length > 0) {
    submitSelector = buildSelector($, $submitBtn[0]);
  }
  
  // 옵션이 있으면 반환
  if (options.length > 0) {
    return {
      form_selector: formSelector,
      submit_selector: submitSelector,
      submit_type: submitType,
      options,
    };
  }
  
  return null;
}

/**
 * 첨부파일 감지 패턴 분석
 * 사이트별로 다양한 첨부파일 링크 구조를 감지하여 적절한 패턴 반환
 */
function detectAttachmentPattern($: cheerio.CheerioAPI, pageUrl?: string): AttachmentConfig | null {
  // URL 기반 패턴 감지 - 알려진 AJAX 사이트
  if (pageUrl) {
    const url = pageUrl.toLowerCase();
    
    // 국민참여입법센터 - fnDownload 기반 첨부파일
    if (url.includes("opinion.lawmaking.go.kr")) {
      return {
        pattern_type: "onclick_fndownload",
        download_url_pattern: "/file/download/{fileId}/{fileKey}",
      };
    }
  }
  // 패턴 1: 국민참여입법센터 - fnDownload('id', 'key') 패턴
  const fnDownloadBtns = $("button[onclick*='fnDownload'], a[onclick*='fnDownload']");
  if (fnDownloadBtns.length > 0) {
    const $btn = fnDownloadBtns.first();
    const onclick = $btn.attr("onclick") || "";
    const match = onclick.match(/fnDownload\s*\(/i);
    if (match) {
      // 컨테이너 찾기
      const $container = $btn.closest("td, dd, li, div").parent().closest("tr, dl, ul, div");
      const containerSelector = $container.length > 0 ? buildSelector($, $container[0]) : ".detailAttach, .formAlign";
      
      return {
        pattern_type: "onclick_fndownload",
        container_selector: containerSelector,
        link_selector: "button[onclick*='fnDownload'], a[onclick*='fnDownload']",
        onclick_function: "fnDownload",
        download_url_pattern: "/file/download/{0}?fileKey={1}",
      };
    }
  }
  
  // 패턴 2: 일반 onclick javascript 패턴 (fn_fileDown, fileDownload 등)
  const jsDownloadPatterns = [
    "fn_fileDown", "fileDownload", "FileDown", "downFile", "fn_download", "getFile"
  ];
  for (const funcName of jsDownloadPatterns) {
    const $btns = $(`button[onclick*='${funcName}'], a[onclick*='${funcName}']`);
    if ($btns.length > 0) {
      const $btn = $btns.first();
      const $container = $btn.closest("td, dd, li, div").parent().closest("tr, dl, ul, div");
      
      return {
        pattern_type: "onclick_javascript",
        container_selector: $container.length > 0 ? buildSelector($, $container[0]) : undefined,
        link_selector: `button[onclick*='${funcName}'], a[onclick*='${funcName}']`,
        onclick_function: funcName,
      };
    }
  }
  
  // 패턴 3: 표준 href 기반 (파일 확장자 또는 download URL)
  const standardSelectors = [
    "a[href*='.hwp']", "a[href*='.hwpx']", "a[href*='.pdf']",
    "a[href*='.doc']", "a[href*='.xls']", "a[href*='.zip']",
    "a[href*='download']", "a[href*='fileDown']", "a[href*='attach']"
  ];
  
  for (const selector of standardSelectors) {
    const $links = $(selector);
    if ($links.length > 0) {
      // 첨부파일 영역 찾기
      const $link = $links.first();
      const $container = $link.closest(".file_area, .attach, .file_list, .attachment, td, dd, li");
      
      return {
        pattern_type: "standard_href",
        container_selector: $container.length > 0 ? buildSelector($, $container[0]) : undefined,
        link_selector: selector,
      };
    }
  }
  
  // 패턴 4: 파일 영역 내 버튼
  const fileAreaSelectors = [
    ".file_area button", ".attach button", ".file_list button",
    ".attachment button", ".fileArea button"
  ];
  for (const selector of fileAreaSelectors) {
    const $btns = $(selector);
    if ($btns.length > 0) {
      const $btn = $btns.first();
      const $container = $btn.closest(".file_area, .attach, .file_list, .attachment, .fileArea");
      
      return {
        pattern_type: "file_area_button",
        container_selector: $container.length > 0 ? buildSelector($, $container[0]) : selector.split(" ")[0],
        link_selector: "button",
      };
    }
  }
  
  // 감지된 패턴이 없으면 자동 감지 모드
  return {
    pattern_type: "auto",
  };
}

function buildSelector($: cheerio.CheerioAPI, el: any): string {
  const tag = el.tagName.toLowerCase();
  const $el = $(el);
  
  // ID가 있으면 ID 사용
  const id = $el.attr("id");
  if (id && !/^\d/.test(id)) {
    return `#${id}`;
  }
  
  // 클래스가 있으면 클래스 사용
  const classes = $el.attr("class");
  if (classes) {
    const classList = classes.split(/\s+/).filter(c => 
      c && c.length > 1 && !/^(on|off|active|show|hide|clearfix)$/i.test(c)
    );
    if (classList.length > 0) {
      return `${tag}.${classList[0]}`;
    }
  }
  
  return tag;
}

/**
 * 한국 정부 사이트 특화 게시판 분석 함수
 * div.board_list, div.brd_body, div.bbs_list 등의 구조를 감지
 * 
 * 지원하는 구조:
 * 1. 단일 ul > 여러 li (각 li가 하나의 게시글)
 * 2. 여러 ul (각 ul이 하나의 게시글, li는 열 데이터)
 */
function analyzeKoreanGovBoardStructure($: cheerio.CheerioAPI, pageUrl: string): DomAnalysisResult | null {
  // 한국 정부/공공기관 사이트에서 자주 사용되는 게시판 컨테이너 선택자
  const boardContainerSelectors = [
    "div.board_list",
    "div.bbs_list", 
    "div.list_wrap",
    "div.boardList",
    "div.bbsList",
    "div.board_wrap",
    "div.bbs_wrap",
    ".board_list",
    ".bbs_list",
    ".list_area",
  ];
  
  for (const containerSelector of boardContainerSelectors) {
    const $container = $(containerSelector).first();
    if ($container.length === 0) continue;
    
    // brd_body 또는 직접 ul 찾기
    let $listContainer = $container.find(".brd_body, .board_body, .list_body, .bbs_body").first();
    if ($listContainer.length === 0) {
      $listContainer = $container;
    }
    
    // 모든 ul 찾기
    const $uls = $listContainer.find("ul");
    if ($uls.length === 0) continue;
    
    // 패턴 1: 여러 ul이 각각 하나의 게시글 (한강유역환경청 스타일)
    // 각 ul 안에 여러 li (순번, 제목, 작성자, 날짜, 조회수)
    const multiUlAnalysis: { title?: string; date?: string; link?: string; author?: string }[] = [];
    
    $uls.each((_, ul) => {
      const $ul = $(ul);
      
      // 네비게이션/메뉴/헤더 ul 제외
      if ($ul.closest("nav, header, .gnb, .lnb, .menu, .brd_head, .board_head, .list_head").length > 0) return;
      
      const $lis = $ul.children("li");
      if ($lis.length < 3) return; // 최소 3개 열 (순번, 제목, 날짜 등)
      
      const analysis: { title?: string; date?: string; link?: string; author?: string } = {};
      
      // 각 li에서 정보 추출
      $lis.each((_, li) => {
        const $li = $(li);
        const $link = $li.find("a").first();
        const liClass = $li.attr("class") || "";
        const liText = cleanText($li.text());
        
        // 제목 찾기 (링크가 있는 li 또는 title 클래스)
        if ($link.length > 0 && !analysis.title) {
          const linkText = cleanText($link.text());
          if (linkText.length >= 5) {
            analysis.title = linkText;
            analysis.link = extractLinkUrl($link, pageUrl);
          }
        }
        
        // 날짜 찾기
        if (!analysis.date && isDateLike(liText)) {
          analysis.date = liText;
        }
        
        // 작성자 찾기 (보통 이름 형식: 2~10자, 숫자 없음)
        if (!analysis.author && liText.length >= 2 && liText.length <= 10 && 
            !/\d/.test(liText) && !analysis.title?.includes(liText)) {
          // 순번이나 조회수 제외 (숫자만 있는 경우)
          if (!/^\d+$/.test(liText)) {
            analysis.author = liText;
          }
        }
      });
      
      if (analysis.title && analysis.link) {
        multiUlAnalysis.push(analysis);
      }
    });
    
    // 패턴 1 성공: 여러 ul이 각각 게시글
    if (multiUlAnalysis.length >= 3) {
      const bodySelector = $listContainer.hasClass("brd_body") ? ".brd_body" 
        : $listContainer.hasClass("board_body") ? ".board_body" 
        : $listContainer.hasClass("list_body") ? ".list_body"
        : "";
      
      // container_selector는 ul들의 부모 (brd_body)
      // item_selector는 각 게시글 (ul)
      const containerFullSelector = bodySelector 
        ? `${containerSelector} ${bodySelector}`
        : containerSelector;
      
      // 강화된 페이지네이션 분석
      const pagination = analyzePagination($, pageUrl);
      
      // 날짜 형식 감지
      const dateFormat = multiUlAnalysis[0]?.date ? detectDateFormat(multiUlAnalysis[0].date) : "unknown";
      
      return {
        success: true,
        board_type: "list",
        rendering: "static_html",
        list: {
          container_selector: containerFullSelector,  // ul들의 부모 (예: div.board_list .brd_body)
          item_selector: "ul",  // 각 ul이 하나의 게시글
          item_count: multiUlAnalysis.length,
          title_selector: "li a, li.title a",
          date_selector: "li",  // 날짜는 li 중 하나
          link_selector: "li a, li.title a",
          author_selector: multiUlAnalysis[0]?.author ? "li" : null,
        },
        pagination,
        samples: {
          titles: multiUlAnalysis.slice(0, 3).map(r => r.title || ""),
          dates: multiUlAnalysis.slice(0, 3).map(r => r.date || ""),
          links: multiUlAnalysis.slice(0, 3).map(r => r.link || ""),
        },
        published_date_rule: {
          source: "list",
          selector: `${containerFullSelector} ul li`,
          format: dateFormat,
        },
      };
    }
    
    // 패턴 2: 단일 ul > 여러 li (각 li가 하나의 게시글)
    const $ul = $uls.first();
    
    // 네비게이션/메뉴 ul 제외
    if ($ul.closest("nav, header, .gnb, .lnb, .menu, .brd_head, .board_head").length > 0) continue;
    
    // brd_head(헤더) 바로 다음의 ul만 처리하도록 확인
    const $brdHead = $container.find(".brd_head, .board_head, .list_head").first();
    if ($brdHead.length > 0) {
      // brd_head가 있으면 brd_body 안의 ul만 대상
      if ($ul.closest(".brd_body, .board_body, .list_body, .bbs_body").length === 0) {
        continue;
      }
    }
    
    const $items = $ul.children("li");
    if ($items.length < 3) continue;
    
    const singleUlAnalysis: { title?: string; date?: string; link?: string; author?: string }[] = [];
    
    $items.each((_, item) => {
      const $item = $(item);
      const $link = $item.find("a").first();
      const analysis: { title?: string; date?: string; link?: string; author?: string } = {};
      
      // 제목과 링크 추출
      if ($link.length > 0) {
        const linkText = cleanText($link.text());
        // 제목이 5자 이상이어야 유효
        if (linkText.length >= 5) {
          analysis.title = linkText;
          analysis.link = extractLinkUrl($link, pageUrl);
        }
      }
      
      // 날짜 찾기 - li 내의 span, em, .date 등에서
      $item.find("span, em, time, .date, .time, li").not("a").each((_, el) => {
        const elText = cleanText($(el).text());
        if (isDateLike(elText) && !analysis.date) {
          analysis.date = elText;
          return false;
        }
      });
      
      // 날짜를 못 찾으면 텍스트 전체에서 날짜 패턴 검색
      if (!analysis.date) {
        const fullText = $item.text();
        const dateMatch = fullText.match(/(\d{4}[-./]\s*\d{1,2}[-./]\s*\d{1,2})/);
        if (dateMatch) {
          analysis.date = dateMatch[1].trim();
        }
      }
      
      // 작성자 찾기
      $item.find(".name, .author, .writer, .user").each((_, el) => {
        const authorText = cleanText($(el).text());
        if (authorText.length > 1 && authorText.length < 30 && !analysis.author) {
          analysis.author = authorText;
          return false;
        }
      });
      
      if (analysis.title && analysis.link) {
        singleUlAnalysis.push(analysis);
      }
    });
    
    if (singleUlAnalysis.length >= 3) {
      // 선택자 구성
      const ulSelector = $listContainer.hasClass("brd_body") || $listContainer.hasClass("board_body") 
        ? `${containerSelector} .brd_body ul, ${containerSelector} .board_body ul`
        : `${containerSelector} ul`;
      
      // 날짜 선택자 결정
      let dateSelector = "li .date, li span";
      const firstItem = $items.first();
      if (firstItem.find(".date").length > 0) {
        dateSelector = ".date";
      } else if (firstItem.find("span[class*='date']").length > 0) {
        dateSelector = "span[class*='date']";
      }
      
      // 강화된 페이지네이션 분석
      const pagination = analyzePagination($, pageUrl);
      
      // 날짜 형식 감지
      const dateFormat = singleUlAnalysis[0]?.date ? detectDateFormat(singleUlAnalysis[0].date) : "unknown";
      
      return {
        success: true,
        board_type: "list",
        rendering: "static_html",
        list: {
          container_selector: ulSelector,
          item_selector: "li",
          item_count: singleUlAnalysis.length,
          title_selector: "a",
          date_selector: dateSelector,
          link_selector: "a",
          author_selector: singleUlAnalysis[0]?.author ? ".name, .author" : null,
        },
        pagination,
        samples: {
          titles: singleUlAnalysis.slice(0, 3).map(r => r.title || ""),
          dates: singleUlAnalysis.slice(0, 3).map(r => r.date || ""),
          links: singleUlAnalysis.slice(0, 3).map(r => r.link || ""),
        },
        published_date_rule: {
          source: "list",
          selector: `${ulSelector} li ${dateSelector}`,
          format: dateFormat,
        },
      };
    }
  }
  
  return null;
}

function analyzeTableStructure($: cheerio.CheerioAPI, pageUrl: string): DomAnalysisResult | null {
  // 모든 테이블 찾기
  const tables = $("table").toArray();
  
  for (const table of tables) {
    const $table = $(table);
    
    // datepicker, calendar 등의 UI 컴포넌트 테이블 제외
    const tableClass = $table.attr("class") || "";
    const tableId = $table.attr("id") || "";
    if (
      /datepicker|calendar|ui-|picker|widget/i.test(tableClass) ||
      /datepicker|calendar|picker/i.test(tableId) ||
      $table.closest(".ui-datepicker, .datepicker, .calendar-widget").length > 0
    ) {
      continue;
    }
    
    const $tbody = $table.find("tbody").length > 0 ? $table.find("tbody") : $table;
    const $rows = $tbody.find("tr").not("thead tr").not(":first-child:has(th)");
    
    // 최소 3개 이상의 행이 있어야 게시판으로 판단
    if ($rows.length < 3) continue;
    
    // 각 행에서 제목, 날짜, 링크 찾기
    const rowAnalysis: { title?: string; date?: string; link?: string; author?: string }[] = [];
    
    $rows.each((_, row) => {
      const $row = $(row);
      const $tds = $row.find("td");
      const analysis: typeof rowAnalysis[0] = {};
      
      $tds.each((idx, td) => {
        const $td = $(td);
        const text = cleanText($td.text());
        const $link = $td.find("a").first();
        
        // 링크가 있고 텍스트가 길면 제목으로 판단
        if ($link.length > 0 && $link.text().trim().length > 5) {
          if (!analysis.title) {
            analysis.title = cleanText($link.text());
            analysis.link = extractLinkUrl($link, pageUrl);
          }
        }
        
        // 날짜 패턴 감지
        if (isDateLike(text) && !analysis.date) {
          analysis.date = text;
        }
      });
      
      if (analysis.title) {
        rowAnalysis.push(analysis);
      }
    });
    
    // 유효한 분석 결과가 3개 이상이면 이 테이블이 게시판
    if (rowAnalysis.length >= 3) {
      const tableSelector = buildSelector($, table);
      const firstRow = $rows.first();
      
      // 제목 셀 선택자 찾기
      let titleSelector = "td a";
      let dateSelector = "td";
      let linkSelector = "td a";
      
      const $tds = firstRow.find("td");
      $tds.each((idx, td) => {
        const $td = $(td);
        const text = cleanText($td.text());
        const $link = $td.find("a").first();
        
        if ($link.length > 0 && $link.text().trim().length > 5) {
          const tdClass = $td.attr("class");
          if (tdClass) {
            titleSelector = `td.${tdClass.split(/\s+/)[0]} a`;
            linkSelector = `td.${tdClass.split(/\s+/)[0]} a`;
          } else {
            titleSelector = `td:nth-child(${idx + 1}) a`;
            linkSelector = `td:nth-child(${idx + 1}) a`;
          }
        }
        
        if (isDateLike(text)) {
          const tdClass = $td.attr("class");
          if (tdClass) {
            dateSelector = `td.${tdClass.split(/\s+/)[0]}`;
          } else {
            dateSelector = `td:nth-child(${idx + 1})`;
          }
        }
      });
      
      // 강화된 페이지네이션 분석
      const pagination = analyzePagination($, pageUrl);
      
      // 날짜 형식 감지
      const dateFormat = rowAnalysis[0]?.date ? detectDateFormat(rowAnalysis[0].date) : "unknown";
      
      return {
        success: true,
        board_type: "table",
        rendering: "static_html",
        list: {
          container_selector: tableSelector,
          item_selector: "tbody tr",
          item_count: rowAnalysis.length,
          title_selector: titleSelector,
          date_selector: dateSelector,
          link_selector: linkSelector,
          author_selector: null,
        },
        pagination,
        samples: {
          titles: rowAnalysis.slice(0, 3).map(r => r.title || ""),
          dates: rowAnalysis.slice(0, 3).map(r => r.date || ""),
          links: rowAnalysis.slice(0, 3).map(r => r.link || ""),
        },
        published_date_rule: {
          source: "list",
          selector: `${tableSelector} tbody tr ${dateSelector}`,
          format: dateFormat,
        },
      };
    }
  }
  
  return null;
}

function analyzeListStructure($: cheerio.CheerioAPI, pageUrl: string): DomAnalysisResult | null {
  // ul, ol 리스트 찾기
  const lists = $("ul, ol").toArray();
  
  for (const list of lists) {
    const $list = $(list);
    const $items = $list.children("li");
    
    if ($items.length < 3) continue;
    
    // 네비게이션 메뉴 제외
    if ($list.closest("nav, header, footer, .gnb, .lnb, .menu").length > 0) continue;
    
    const itemAnalysis: { title?: string; date?: string; link?: string }[] = [];
    
    $items.each((_, item) => {
      const $item = $(item);
      const $link = $item.find("a").first();
      const text = cleanText($item.text());
      const analysis: typeof itemAnalysis[0] = {};
      
      if ($link.length > 0 && $link.text().trim().length > 5) {
        analysis.title = cleanText($link.text());
        analysis.link = extractLinkUrl($link, pageUrl);
      }
      
      // 날짜 찾기
      $item.find("span, em, time, .date, .time").each((_, el) => {
        const elText = cleanText($(el).text());
        if (isDateLike(elText)) {
          analysis.date = elText;
          return false;
        }
      });
      
      if (analysis.title) {
        itemAnalysis.push(analysis);
      }
    });
    
    if (itemAnalysis.length >= 3) {
      const listSelector = buildSelector($, list);
      
      // 강화된 페이지네이션 분석
      const pagination = analyzePagination($, pageUrl);
      
      return {
        success: true,
        board_type: "list",
        rendering: "static_html",
        list: {
          container_selector: listSelector,
          item_selector: "li",
          item_count: itemAnalysis.length,
          title_selector: "a",
          date_selector: "span, .date",
          link_selector: "a",
          author_selector: null,
        },
        pagination,
        samples: {
          titles: itemAnalysis.slice(0, 3).map(r => r.title || ""),
          dates: itemAnalysis.slice(0, 3).map(r => r.date || ""),
          links: itemAnalysis.slice(0, 3).map(r => r.link || ""),
        },
        published_date_rule: {
          source: "list",
          selector: `${listSelector} li .date, ${listSelector} li span`,
          format: itemAnalysis[0]?.date ? detectDateFormat(itemAnalysis[0].date) : "unknown",
        },
      };
    }
  }
  
  return null;
}

function analyzeDivStructure($: cheerio.CheerioAPI, pageUrl: string): DomAnalysisResult | null {
  // 반복되는 div 클래스 찾기
  const divClasses: Record<string, cheerio.Element[]> = {};
  
  $("div[class]").each((_, div) => {
    const $div = $(div);
    // 헤더/푸터/네비 제외
    if ($div.closest("header, footer, nav, aside, .gnb, .lnb").length > 0) return;
    
    const classes = $div.attr("class")?.split(/\s+/) || [];
    const mainClass = classes.find(c => c.length > 2 && !/^(container|wrapper|wrap|inner|outer|row|col|clearfix)$/i.test(c));
    
    if (mainClass) {
      if (!divClasses[mainClass]) divClasses[mainClass] = [];
      divClasses[mainClass].push(div);
    }
  });
  
  // 3개 이상 반복되는 클래스 찾기
  for (const [className, elements] of Object.entries(divClasses)) {
    if (elements.length < 3 || elements.length > 100) continue;
    
    const itemAnalysis: { title?: string; date?: string; link?: string }[] = [];
    
    for (const el of elements) {
      const $el = $(el);
      const $link = $el.find("a").first();
      const analysis: typeof itemAnalysis[0] = {};
      
      if ($link.length > 0 && $link.text().trim().length > 5) {
        analysis.title = cleanText($link.text());
        analysis.link = extractLinkUrl($link, pageUrl);
      }
      
      // 날짜 찾기
      $el.find("span, em, time, .date, .time").each((_, dateEl) => {
        const elText = cleanText($(dateEl).text());
        if (isDateLike(elText)) {
          analysis.date = elText;
          return false;
        }
      });
      
      if (analysis.title) {
        itemAnalysis.push(analysis);
      }
    }
    
    if (itemAnalysis.length >= 3) {
      // 강화된 페이지네이션 분석
      const pagination = analyzePagination($, pageUrl);
      
      // 부모 요소를 찾아서 container_selector로 사용
      const $firstItem = $(elements[0]);
      const $parent = $firstItem.parent();
      let containerSelector = "";
      
      // 부모의 클래스 또는 ID로 선택자 구성
      const parentId = $parent.attr("id");
      const parentClasses = $parent.attr("class")?.split(/\s+/).filter(c => c.length > 2) || [];
      
      if (parentId) {
        containerSelector = `#${parentId}`;
      } else if (parentClasses.length > 0) {
        // 의미 있는 클래스 선택 (list, container, wrap 등 포함)
        const meaningfulClass = parentClasses.find(c => 
          /list|container|wrap|board|content|media/i.test(c)
        ) || parentClasses[0];
        containerSelector = `div.${meaningfulClass}`;
      } else {
        // 부모에 클래스가 없으면 조부모 확인
        const $grandparent = $parent.parent();
        const grandparentClasses = $grandparent.attr("class")?.split(/\s+/).filter(c => c.length > 2) || [];
        if (grandparentClasses.length > 0) {
          const meaningfulClass = grandparentClasses.find(c => 
            /list|container|wrap|board|content|media/i.test(c)
          ) || grandparentClasses[0];
          containerSelector = `div.${meaningfulClass}`;
        }
      }
      
      // container가 item과 같거나 비어있으면 부모 태그 사용
      if (!containerSelector || containerSelector === `div.${className}`) {
        const parentTag = $parent.prop("tagName")?.toLowerCase() || "div";
        if (parentClasses.length > 0) {
          containerSelector = `${parentTag}.${parentClasses.join(".")}`;
        }
      }
      
      return {
        success: true,
        board_type: "div",
        rendering: "static_html",
        list: {
          container_selector: containerSelector || `div.${className}`,
          item_selector: `div.${className}`,
          item_count: itemAnalysis.length,
          title_selector: "a",
          date_selector: "span, .date",
          link_selector: "a",
          author_selector: null,
        },
        pagination,
        samples: {
          titles: itemAnalysis.slice(0, 3).map(r => r.title || ""),
          dates: itemAnalysis.slice(0, 3).map(r => r.date || ""),
          links: itemAnalysis.slice(0, 3).map(r => r.link || ""),
        },
        published_date_rule: {
          source: "list",
          selector: `div.${className} .date, div.${className} span`,
          format: itemAnalysis[0]?.date ? detectDateFormat(itemAnalysis[0].date) : "unknown",
        },
      };
    }
  }
  
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.list_url) {
      return NextResponse.json({ error: "list_url이 필요합니다." }, { status: 400 });
    }

    const html = await fetchHtml(body.list_url);
    const $ = cheerio.load(html);
    const pageUrl = body.list_url;
    
    // 순서대로 구조 분석 시도 (페이지 URL 전달하여 페이지네이션 분석에 활용)
    // 1. 한국 정부/공공기관 사이트 특화 패턴 먼저 시도 (div.board_list 등)
    let result = analyzeKoreanGovBoardStructure($, pageUrl);
    // 2. 일반 테이블 구조
    if (!result) result = analyzeTableStructure($, pageUrl);
    // 3. 일반 ul/li 리스트 구조
    if (!result) result = analyzeListStructure($, pageUrl);
    // 4. 반복되는 div 구조
    if (!result) result = analyzeDivStructure($, pageUrl);
    
    if (!result) {
      // JavaScript 렌더링이 필요한지 체크
      const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
      const needsJs = textContent.length < 2000;
      
      return NextResponse.json({
        success: false,
        error: needsJs 
          ? "게시판 목록을 찾을 수 없습니다. JavaScript 렌더링이 필요한 페이지일 수 있습니다."
          : "게시판 목록 구조를 감지하지 못했습니다. 페이지 URL을 확인해주세요.",
        rendering: needsJs ? "dynamic_js" : "static_html",
      });
    }
    
    // 사이트 내 검색 옵션 감지
    const siteSearchConfig = detectSiteSearchOptions($);
    if (siteSearchConfig) {
      result.site_search_config = siteSearchConfig;
    }
    
    // 첨부파일 패턴 감지
    const attachmentConfig = detectAttachmentPattern($, body.list_url);
    if (attachmentConfig) {
      result.attachment_config = attachmentConfig;
    }
    
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[analyze-dom] Error:", err);
    return NextResponse.json({ error: err.message || "분석 실패" }, { status: 500 });
  }
}
