import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(45000), // 45초로 증가
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (err: any) {
    const msg = err?.name === "TimeoutError" || err?.code === 23
      ? "사이트 응답 시간 초과. 사이트가 느리거나 접근이 차단되었을 수 있습니다."
      : err.message;
    throw new Error(`URL 접근 실패: ${msg}`);
  }
}

/**
 * 텍스트에서 날짜 패턴을 추출
 */
function extractDateFromText(text: string): string | null {
  const datePatterns = [
    /(\d{4}-\d{2}-\d{2})/, // 2024-01-15
    /(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})/, // 2024.01.15 or 2024. 01. 15
    /(\d{4}\/\d{2}\/\d{2})/, // 2024/01/15
    /(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/, // 2024년 1월 15일
    /(\d{2}-\d{2}-\d{2})/, // 24-01-15
    /(\d{2}\.\d{2}\.\d{2})/, // 24.01.15
  ];
  
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

/**
 * 텍스트가 날짜인지 판단
 */
function isDateLike(text: string): boolean {
  if (!text || text.length < 8 || text.length > 20) return false;
  return /\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}/.test(text) ||
         /\d{2}[-./]\d{2}[-./]\d{2}/.test(text);
}

function extractDatesFromHtml(
  html: string,
  rule: { source?: string; selector?: string; format?: string; regex?: string }
): string[] {
  const $ = cheerio.load(html);
  const dates: string[] = [];
  const selector = rule.selector || "";

  // 1. selector가 있으면 해당 선택자로 직접 추출 시도
  if (selector) {
    try {
      $(selector).each((_, el) => {
        if (dates.length >= 10) return false;
        const text = $(el).text().trim();
        const date = extractDateFromText(text);
        if (date) {
          dates.push(date);
        }
      });
    } catch {
      // 선택자 오류 무시
    }
  }

  // 2. 한국 정부 사이트 특화: div.board_list 구조 (여러 ul이 각각 하나의 게시글)
  if (dates.length === 0) {
    // brd_body 내의 각 ul에서 날짜 찾기
    $("div.board_list .brd_body ul, div.bbs_list .brd_body ul").each((_, ul) => {
      if (dates.length >= 10) return false;
      
      // 각 ul 내의 li에서 날짜 찾기
      $(ul).children("li").each((_, li) => {
        const text = $(li).text().trim();
        if (isDateLike(text)) {
          const date = extractDateFromText(text);
          if (date && !dates.includes(date)) {
            dates.push(date);
            return false; // 첫 번째 날짜만 추출
          }
        }
      });
    });
  }

  // 3. 테이블 구조에서 날짜 찾기
  if (dates.length === 0) {
    $("table tbody tr").each((_, tr) => {
      if (dates.length >= 10) return false;
      
      $(tr).find("td").each((_, td) => {
        const text = $(td).text().trim();
        if (isDateLike(text)) {
          const date = extractDateFromText(text);
          if (date && !dates.includes(date)) {
            dates.push(date);
            return false;
          }
        }
      });
    });
  }

  // 4. 일반 ul > li 구조에서 날짜 찾기
  if (dates.length === 0) {
    $("ul li").each((_, li) => {
      if (dates.length >= 10) return false;
      
      // li 내에서 날짜 관련 요소 찾기
      $(li).find("span, em, time, .date, .time").each((_, el) => {
        const text = $(el).text().trim();
        if (isDateLike(text)) {
          const date = extractDateFromText(text);
          if (date && !dates.includes(date)) {
            dates.push(date);
            return false;
          }
        }
      });
      
      // 날짜를 못 찾았으면 li 전체 텍스트에서 검색
      if (dates.length === 0 || !dates[dates.length - 1]) {
        const fullText = $(li).text();
        const date = extractDateFromText(fullText);
        if (date && !dates.includes(date)) {
          dates.push(date);
        }
      }
    });
  }

  // 5. span, div, em 등에서 날짜 클래스 기반 검색
  if (dates.length === 0) {
    $("span.date, div.date, em.date, .date, .time, time, [class*='date']").each((_, el) => {
      if (dates.length >= 10) return false;
      const text = $(el).text().trim();
      const date = extractDateFromText(text);
      if (date && !dates.includes(date)) {
        dates.push(date);
      }
    });
  }

  // 6. regex가 있으면 추가로 적용
  if (rule.regex && dates.length === 0) {
    try {
      const customRegex = new RegExp(rule.regex, "g");
      let match;
      while ((match = customRegex.exec(html)) !== null && dates.length < 10) {
        if (match[1]) {
          dates.push(match[1]);
        } else if (match[0]) {
          dates.push(match[0]);
        }
      }
    } catch {
      // 정규식 오류 무시
    }
  }

  // 중복 제거 및 상위 10개만 반환
  return [...new Set(dates)].filter(d => d).slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { list_url, published_date_rule } = body;

    if (!list_url || typeof list_url !== "string") {
      return NextResponse.json({ error: "list_url이 필요합니다." }, { status: 400 });
    }

    if (!published_date_rule || typeof published_date_rule !== "object") {
      return NextResponse.json({ error: "published_date_rule이 필요합니다." }, { status: 400 });
    }

    // URL에서 HTML 가져오기
    const htmlContent = await fetchUrlContent(list_url);

    // 규칙을 적용하여 날짜 추출 시도
    const extractedDates = extractDatesFromHtml(htmlContent, published_date_rule);

    if (extractedDates.length > 0) {
      return NextResponse.json({
        success: true,
        message: `${extractedDates.length}개의 날짜를 성공적으로 추출했습니다.`,
        samples: extractedDates,
      });
    } else {
      return NextResponse.json({
        success: false,
        message: "지정된 규칙으로 날짜를 추출하지 못했습니다. selector나 format을 확인해주세요.",
        samples: [],
      });
    }
  } catch (err: any) {
    console.error("[test-date-rule] Error:", err);
    return NextResponse.json(
      { error: err.message || "테스트 실패" },
      { status: 500 }
    );
  }
}
