import { NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface SiteStructure {
  board_type: "table" | "list" | "card" | "unknown";
  rendering: "static_html" | "dynamic_js";
  list: {
    container_selector: string;
    item_selector: string;
    title_selector: string;
    date_selector: string;
    link_selector: string;
    author_selector?: string;
    has_number_column?: boolean;
  };
  pagination: {
    type: "page_param" | "next_button" | "scroll" | "none";
    param?: string;
    selector?: string;
  };
  detail?: {
    content_selector: string;
    attachments_selector?: string;
    date_selector?: string;
  };
  sample_data?: {
    titles: string[];
    dates: string[];
  };
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
    return html.slice(0, 60000);
  } catch (err: any) {
    throw new Error(`URL 접근 실패: ${err.message}`);
  }
}

// HTML에서 실제 클래스명들을 추출
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

// HTML에서 테이블 구조 감지
function detectTableStructure(html: string): { hasTable: boolean; tableInfo?: string } {
  const tablePattern = /<table[^>]*class=["']([^"']+)["'][^>]*>[\s\S]*?<\/table>/gi;
  const tables: string[] = [];
  let match;
  while ((match = tablePattern.exec(html)) !== null) {
    const tableHtml = match[0];
    const trCount = (tableHtml.match(/<tr/gi) || []).length;
    if (trCount >= 5) {
      tables.push(`table.${match[1].split(/\s+/)[0]} (${trCount}행)`);
    }
  }
  // 클래스 없는 테이블도 확인
  const plainTablePattern = /<table(?![^>]*class)[^>]*>[\s\S]*?<\/table>/gi;
  while ((match = plainTablePattern.exec(html)) !== null) {
    const trCount = (match[0].match(/<tr/gi) || []).length;
    if (trCount >= 5) {
      tables.push(`table (클래스 없음, ${trCount}행)`);
    }
  }
  return {
    hasTable: tables.length > 0,
    tableInfo: tables.length > 0 ? tables.join(", ") : undefined
  };
}

// HTML에서 반복되는 패턴 감지 (게시판 목록 후보)
function detectRepeatingPatterns(html: string): string[] {
  const patterns: string[] = [];
  
  // 1. 같은 클래스를 가진 요소가 3개 이상 반복되는 패턴 찾기
  const classCountMap: Record<string, number> = {};
  const classPattern = /class=["']([^"']+)["']/gi;
  let match;
  while ((match = classPattern.exec(html)) !== null) {
    const classes = match[1].split(/\s+/);
    for (const cls of classes) {
      if (cls.length > 2 && cls.length < 30 && !/^(clearfix|hidden|show|active|on|off)$/i.test(cls)) {
        classCountMap[cls] = (classCountMap[cls] || 0) + 1;
      }
    }
  }
  
  // 3개 이상 반복되는 클래스 (잠재적 목록 항목)
  const repeatingClasses = Object.entries(classCountMap)
    .filter(([, count]) => count >= 3 && count <= 100)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  if (repeatingClasses.length > 0) {
    patterns.push(`반복 클래스: ${repeatingClasses.map(([cls, cnt]) => `.${cls}(${cnt}개)`).join(", ")}`);
  }
  
  // 2. 테이블 내 tr 개수
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi) || [];
  for (const table of tableMatch) {
    const tbodyMatch = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const trArea = tbodyMatch ? tbodyMatch[1] : table;
    const trCount = (trArea.match(/<tr[^>]*>/gi) || []).length;
    if (trCount >= 3) {
      const tableClassMatch = table.match(/class=["']([^"']+)["']/i);
      const tableClass = tableClassMatch ? `.${tableClassMatch[1].split(/\s+/)[0]}` : "";
      patterns.push(`테이블: table${tableClass} tbody tr (${trCount}행) → item_selector 후보`);
    }
  }
  
  // 3. ul/ol 내 li 개수
  const listMatch = html.match(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi) || [];
  for (const list of listMatch) {
    const liCount = (list.match(/<li[^>]*>/gi) || []).length;
    if (liCount >= 3) {
      const listClassMatch = list.match(/class=["']([^"']+)["']/i);
      const listClass = listClassMatch ? `.${listClassMatch[1].split(/\s+/)[0]}` : "";
      const tagMatch = list.match(/^<(ul|ol)/i);
      const tag = tagMatch ? tagMatch[1] : "ul";
      patterns.push(`리스트: ${tag}${listClass} li (${liCount}개) → item_selector 후보`);
    }
  }
  
  // 4. div 반복 패턴 (같은 부모 내 같은 클래스 div)
  const divPatterns = html.match(/<div[^>]*class=["']([^"']+)["'][^>]*>/gi) || [];
  const divClassCount: Record<string, number> = {};
  for (const div of divPatterns) {
    const classMatch = div.match(/class=["']([^"']+)["']/i);
    if (classMatch) {
      const firstClass = classMatch[1].split(/\s+/)[0];
      if (firstClass && !/^(container|wrapper|wrap|inner|outer|row|col|clearfix)$/i.test(firstClass)) {
        divClassCount[firstClass] = (divClassCount[firstClass] || 0) + 1;
      }
    }
  }
  
  const repeatingDivs = Object.entries(divClassCount)
    .filter(([, count]) => count >= 3 && count <= 50)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  if (repeatingDivs.length > 0) {
    patterns.push(`반복 div: ${repeatingDivs.map(([cls, cnt]) => `div.${cls}(${cnt}개)`).join(", ")} → item_selector 후보`);
  }
  
  return patterns;
}

// HTML에서 게시판 영역 추출 (헤더/푸터/네비 제외)
function extractBoardArea(html: string): string {
  // 주요 콘텐츠 영역 패턴
  const contentPatterns = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*(?:id|class)=["'][^"']*(?:content|board|list|bbs|게시|목록)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*(?:id|class)=["'][^"']*(?:content|board|list)[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
  ];
  
  for (const pattern of contentPatterns) {
    const match = html.match(pattern);
    if (match && match[1] && match[1].length > 500) {
      return match[1];
    }
  }
  
  // 헤더/푸터/네비 제거
  let cleaned = html
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");
  
  return cleaned;
}

// 날짜 패턴 감지
function detectDatePatterns(html: string): string[] {
  const patterns = [
    { regex: /\d{4}-\d{2}-\d{2}/g, format: "YYYY-MM-DD" },
    { regex: /\d{4}\.\d{2}\.\d{2}/g, format: "YYYY.MM.DD" },
    { regex: /\d{4}\/\d{2}\/\d{2}/g, format: "YYYY/MM/DD" },
    { regex: /\d{2}-\d{2}-\d{2}/g, format: "YY-MM-DD" },
    { regex: /\d{2}\.\d{2}\.\d{2}/g, format: "YY.MM.DD" },
    { regex: /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, format: "YYYY년 MM월 DD일" },
  ];
  
  const found: string[] = [];
  for (const p of patterns) {
    const matches = html.match(p.regex);
    if (matches && matches.length >= 3) {
      found.push(`${p.format} (${matches.length}개 발견: ${matches.slice(0, 3).join(", ")})`);
    }
  }
  return found;
}

// ID 속성 추출
function extractIds(html: string): string[] {
  const idPattern = /id=["']([^"']+)["']/gi;
  const ids = new Set<string>();
  let match;
  while ((match = idPattern.exec(html)) !== null) {
    if (match[1].length > 2 && match[1].length < 50) {
      ids.add(match[1]);
    }
  }
  return Array.from(ids).slice(0, 30);
}

async function analyzeWithOpenAI(
  htmlContent: string,
  listUrl: string,
  refinePrompt?: string,
  currentRule?: string
): Promise<{ published_date_rule: Record<string, unknown>; site_structure: SiteStructure }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  // HTML에서 실제 정보 추출
  const existingClasses = extractClassNames(htmlContent);
  const existingIds = extractIds(htmlContent);
  const tableInfo = detectTableStructure(htmlContent);
  const datePatterns = detectDatePatterns(htmlContent);
  const boardArea = extractBoardArea(htmlContent);
  const repeatingPatterns = detectRepeatingPatterns(htmlContent);

  // 게시판이 없는 페이지인지 판단
  const hasBoardLikeStructure = repeatingPatterns.some(p => 
    p.includes("item_selector 후보") || p.includes("테이블:") || p.includes("리스트:")
  );

  const systemPrompt = `당신은 10년 경력의 웹 스크래핑 전문가입니다. 주어진 HTML을 정밀하게 분석하여 게시판 데이터 추출을 위한 정확한 CSS 선택자를 생성해야 합니다.

## 🚨 가장 중요: item_selector
**item_selector는 전체 설정의 핵심입니다!**
- 게시판 목록에서 **각 게시글 항목(행)**을 선택하는 선택자
- **최소 3개 이상의 항목**이 매칭되어야 함
- 헤더, 로고, 푸터가 아닌 **실제 게시글 목록만** 선택
- 이 선택자가 틀리면 title/date/link도 모두 실패함
${!hasBoardLikeStructure ? `
## ⚠️ 경고: 이 페이지에 게시판 목록이 없을 수 있습니다!
반복되는 목록 구조가 감지되지 않았습니다. 메인 페이지나 상세 페이지일 수 있습니다.
게시판 목록이 확실히 없다면 item_selector에 "NOT_FOUND"를 입력하세요.` : ""}

## ⚠️ 핵심 원칙
1. **오직 HTML에 실제 존재하는 클래스/ID/태그만 사용**
2. **헤더(header), 로고(h1.logo), 네비게이션(nav), 푸터(footer), 사이드바(aside)는 절대 무시**
3. **게시판 본문 영역만 분석** - main, content, board, list 등의 영역 찾기
4. **제목은 게시글 제목만** - "바로가기", "메뉴", "홈" 같은 네비게이션 링크 제외
5. **날짜는 게시일만** - 현재 날짜, 저작권 연도, "이 누리집은..." 문구 제외

## 📊 HTML 분석 결과 (자동 추출)
- **발견된 클래스**: ${existingClasses.slice(0, 60).join(", ")}
- **발견된 ID**: ${existingIds.slice(0, 20).join(", ")}
${tableInfo.hasTable ? `- **테이블 구조**: ${tableInfo.tableInfo}` : "- **테이블 구조**: 없음"}
- **날짜 패턴**: ${datePatterns.length > 0 ? datePatterns.join("; ") : "명확한 패턴 없음"}

## 🎯 반복 패턴 감지 (item_selector 후보) - 매우 중요!
${repeatingPatterns.length > 0 ? repeatingPatterns.join("\n") : "⚠️ 반복되는 목록 구조가 감지되지 않음 - 게시판 목록 페이지가 맞는지 확인 필요"}
**위 "item_selector 후보"에서 선택하세요! 임의로 만들지 마세요.**

## 📋 출력 형식 (JSON만 출력, 다른 텍스트 금지)
{
  "published_date_rule": {
    "source": "list",
    "selector": "CSS 선택자 (예: .board_list td.date, table#list tr td:nth-child(4))",
    "format": "날짜 형식 (예: YYYY-MM-DD)",
    "regex": "정규식 (텍스트에서 날짜만 추출 필요시)"
  },
  "site_structure": {
    "board_type": "table | list | card",
    "rendering": "static_html | dynamic_js",
    "list": {
      "container_selector": "게시판 목록 컨테이너 (예: table.board_list, ul.post_list, div#boardList)",
      "item_selector": "🚨 핵심! 개별 게시글 행 - 최소 3개 이상 매칭 필요 (예: tbody tr, li.item, div.post)",
      "title_selector": "item_selector 내부의 제목 (예: td.subject a, .title a)",
      "date_selector": "item_selector 내부의 날짜 (예: td.date, span.time)",
      "link_selector": "item_selector 내부의 상세 링크 (예: td.subject a[href])",
      "author_selector": "작성자 (없으면 null)"
    },
    "pagination": {
      "type": "page_param | next_button | none",
      "param": "페이지 파라미터 (예: page, pageNo, p)",
      "selector": "다음 버튼 선택자 (next_button인 경우)"
    },
    "detail": {
      "content_selector": "본문 예상 (예: .view_content, #article_body)",
      "attachments_selector": "첨부파일 예상 (예: .file_list, .attach)"
    },
    "sample_data": {
      "titles": ["HTML에서 추출한 실제 게시글 제목 3개"],
      "dates": ["HTML에서 추출한 실제 날짜 3개"]
    }
  }
}

## 🔍 선택자 작성 가이드

### 테이블 구조 (가장 흔함)
\`\`\`
container: table.board_list, table#list, div.board_wrap table
item: tbody tr, tr:not(:first-child), tr.item
title: td.subject a, td:nth-child(2) a, td.title a
date: td.date, td:nth-child(5), td.regdate
link: td.subject a[href], td.title a[href]
\`\`\`

### 리스트 구조
\`\`\`
container: ul.board_list, div.list_wrap
item: li, li.item, div.list_item
title: a.title, .subject a, h4 a
date: span.date, .time, .created
\`\`\`

### 선택자 구체화 규칙
1. **클래스가 있으면 반드시 사용**: \`div.board_list\` > \`div\`
2. **ID가 있으면 우선 사용**: \`#board_list\` > \`.board_list\`
3. **위치 기반 선택**: \`td:nth-child(3)\` (3번째 컬럼)
4. **복합 선택자**: \`table.board_list tbody tr td.subject a\`

## ⚠️ 흔한 실수 방지
- ❌ \`a\` 만 사용 → 모든 링크 선택됨 → ✅ \`.board_list td a\`
- ❌ \`li\` 만 사용 → 메뉴 li도 선택됨 → ✅ \`.post_list li\`
- ❌ \`h1.logo a\` → 헤더 로고 선택됨 → ✅ 게시판 영역 내 선택자 사용
- ❌ \`div.ev_cont\` 1개만 매칭 → 게시판 아님 → ✅ 여러 개 항목이 있는 영역 찾기
- ❌ "이 누리집은..." 텍스트를 날짜로 인식 → ✅ 실제 날짜 패턴(YYYY-MM-DD 등) 확인
- ❌ 추측으로 클래스 작성 → ✅ HTML에서 확인된 클래스만
- ❌ sample_data에 "제목1" 같은 가짜 데이터 → ✅ HTML에서 실제 추출한 텍스트

## 🎯 게시판 영역 찾기 팁
1. **테이블 찾기**: \`<table>\` 태그 중 \`<tr>\`이 5개 이상인 것
2. **리스트 찾기**: \`<ul>\` 또는 \`<ol>\` 중 \`<li>\`가 5개 이상인 것
3. **반복 패턴 찾기**: 같은 클래스가 여러 번 반복되는 구조
4. **제외 영역**: header, footer, nav, aside, .gnb, .lnb, .menu 등은 무시`;

  // 게시판 영역만 추출하여 분석 정확도 향상
  const analysisHtml = boardArea.length > 5000 ? boardArea : htmlContent;

  let userPrompt = `## 분석 대상 URL
${listUrl}

## HTML 본문 (게시판 영역 추출됨, ${analysisHtml.length}자)
\`\`\`html
${analysisHtml.slice(0, 40000)}
\`\`\`

위 HTML을 분석하여 게시판 구조와 게시일 규칙 JSON을 생성하세요.
`;

  if (currentRule) {
    userPrompt += `\n## ⚠️ 이전 분석 결과 (수정 필요)
${currentRule}
위 설정으로 정합성 테스트 실패. 선택자를 더 구체적으로 수정하세요.`;
  }

  if (refinePrompt) {
    userPrompt += `\n## 추가 지시사항
${refinePrompt}`;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2500,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API 오류: ${errData.error?.message || response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || "";

  // JSON 추출 시도
  let jsonStr = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    const result = JSON.parse(jsonStr);
    return {
      published_date_rule: result.published_date_rule || result,
      site_structure: result.site_structure || null,
    };
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

    const { list_url, refine_prompt, current_rule } = body;

    if (!list_url || typeof list_url !== "string") {
      return NextResponse.json({ error: "list_url이 필요합니다." }, { status: 400 });
    }

    // URL에서 HTML 가져오기
    const htmlContent = await fetchUrlContent(list_url);

    // OpenAI로 분석 (전체 구조 + 게시일 규칙)
    const { published_date_rule, site_structure } = await analyzeWithOpenAI(
      htmlContent,
      list_url,
      refine_prompt,
      current_rule
    );

    return NextResponse.json({
      ok: true,
      published_date_rule,
      site_structure,
    });
  } catch (err: any) {
    console.error("[analyze-date-rule] Error:", err);
    return NextResponse.json(
      { error: err.message || "분석 실패" },
      { status: 500 }
    );
  }
}
