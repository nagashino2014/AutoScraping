import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { getBrowser } from "@/lib/scraper/browser";

interface WebConfig {
  parse_rules?: {
    title?: string;
    date?: string;
    content?: string;
    link?: string;
    [key: string]: string | undefined;
  };
  pagination?: {
    type?: string;
    param?: string;
    selector?: string;
  };
  rendering?: string;
  list?: {
    item_selector?: string;
    [key: string]: unknown;
  };
  detail?: {
    content_selector?: string;
    attachments_selector?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

async function fetchUrlContent(url: string, rendering?: string): Promise<string> {
  // dynamic_js인 경우 Playwright 사용
  if (rendering === "dynamic_js") {
    let browser = null;
    let context = null;
    let page = null;
    try {
      browser = await getBrowser();
      context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
      });
      page = await context.newPage();
      
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      
      // JavaScript 렌더링 대기
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const html = await page.content();
      return html;
    } catch (err: any) {
      throw new Error(`URL 접근 실패 (dynamic_js): ${err.message}`);
    } finally {
      if (page) {
        try { await page.close(); } catch { /* ignore */ }
      }
      if (context) {
        try { await context.close(); } catch { /* ignore */ }
      }
    }
  }
  
  // static_html인 경우 fetch 사용
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
    return await res.text();
  } catch (err: any) {
    throw new Error(`URL 접근 실패: ${err.message}`);
  }
}

function safeText(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function pickSamples(texts: string[], limit = 2) {
  const uniq = Array.from(new Set(texts.map((t) => safeText(t)).filter(Boolean)));
  return uniq.slice(0, limit);
}

function isNoneSelector(sel?: string) {
  if (!sel) return true;
  const s = sel.trim().toLowerCase();
  return s === "none" || s === "null" || s === "undefined";
}

function checkSelectorGlobal($: cheerio.CheerioAPI, selector: string) {
  const nodes = $(selector);
  const texts: string[] = [];
  nodes.slice(0, 5).each((_, el) => {
    const t = safeText($(el).text());
    if (t) texts.push(t);
  });
  return { found: nodes.length > 0, count: nodes.length, samples: pickSamples(texts, 2) };
}

function checkSelectorWithinItems(
  $: cheerio.CheerioAPI,
  itemNodes: cheerio.Cheerio<cheerio.Element>,
  selector: string
) {
  let itemMatched = 0;
  const texts: string[] = [];
  itemNodes.each((_, el) => {
    const found = $(el).find(selector);
    if (found.length > 0) {
      itemMatched++;
      if (texts.length < 10) {
        const t = safeText(found.first().text());
        if (t) texts.push(t);
      }
    }
  });
  return { itemMatched, samples: pickSamples(texts, 2) };
}

function validateWebConfig(config: WebConfig, html: string): { success: boolean; details: string[] } {
  const details: string[] = [];
  let hasErrors = false;
  let foundCount = 0;
  let totalCount = 0;

  const $ = cheerio.load(html);

  // 범용 기준(하드코딩 X): 목록은 최소 3개 이상 항목이 있어야 게시판으로 판단
  const MIN_ITEMS = 3;
  // Global 검색에서도 최소 개수 필요 (헤더/로고 1개 매칭 방지)
  const MIN_GLOBAL = 3;

  const listItemSelector = config.list?.item_selector?.toString().trim() || "";
  const listContainerSelector = (config.list as any)?.container_selector?.toString().trim() || "";

  let itemNodes: cheerio.Cheerio<cheerio.Element> | null = null;
  let listValidationFailed = false;

  // list 검증 우선 (핵심 검증 - 이게 실패하면 전체 실패)
  if (listItemSelector) {
    // NOT_FOUND인 경우 - 게시판 목록이 없는 페이지
    if (listItemSelector.toUpperCase() === "NOT_FOUND") {
      details.push(`⚠ list.item_selector: NOT_FOUND (이 페이지에 게시판 목록이 없음)`);
      details.push(`  → 게시판 목록이 있는 페이지 URL을 입력하세요.`);
      hasErrors = true;
      listValidationFailed = true;
    } else {
      totalCount++;
      try {
        itemNodes = listContainerSelector ? $(listContainerSelector).find(listItemSelector) : $(listItemSelector);
        const itemCount = itemNodes.length;
        if (itemCount >= MIN_ITEMS) {
          foundCount++;
          details.push(`✓ list.item_selector (${listItemSelector}): ${itemCount}개 항목 발견`);
        } else if (itemCount > 0) {
          details.push(`✗ list.item_selector (${listItemSelector}): ${itemCount}개만 발견 (최소 ${MIN_ITEMS}개 필요, 게시판 목록이 아닌 영역일 가능성)`);
          hasErrors = true;
          listValidationFailed = true;
        } else {
          details.push(`✗ list.item_selector (${listItemSelector}): 요소를 찾을 수 없음`);
          hasErrors = true;
          listValidationFailed = true;
        }
      } catch (e: any) {
        details.push(`✗ list.item_selector (${listItemSelector}): 선택자 오류 (${e.message})`);
        hasErrors = true;
        listValidationFailed = true;
      }
    }
  } else {
    details.push(`✗ list.item_selector: 설정되지 않음 (필수)`);
    hasErrors = true;
    listValidationFailed = true;
  }

  // list 검증이 실패하면 parse_rules 검증은 의미 없음
  if (listValidationFailed) {
    details.push(`⚠ list.item_selector가 올바르지 않아 parse_rules 검증을 건너뜁니다.`);
    details.push(`  → 먼저 게시판 목록의 각 항목(행)을 정확히 선택하는 item_selector를 설정하세요.`);
    details.push(`  → 예시: table.board_list tbody tr, ul.post_list li, div.list_wrap div.item 등`);
  } else {
    // parse_rules 검증 (item scope 기준 - 각 항목 내부에서 검증)
    if (config.parse_rules) {
      for (const [field, selector] of Object.entries(config.parse_rules)) {
        const sel = typeof selector === "string" ? selector.trim() : "";
        if (!sel) continue;

        // author는 optional
        if (field === "author" && isNoneSelector(sel)) {
          details.push(`ℹ parse_rules.author: none (작성자 추출 생략)`);
          continue;
        }

        totalCount++;

        try {
          if (itemNodes && itemNodes.length >= MIN_ITEMS) {
            // 항목 내부(scope) 기준으로 검증
            const scoped = checkSelectorWithinItems($, itemNodes, sel);
            const matchRate = scoped.itemMatched / itemNodes.length;
            
            if (scoped.itemMatched >= MIN_ITEMS && matchRate >= 0.5) {
              foundCount++;
              details.push(`✓ parse_rules.${field} (${sel}): ${scoped.itemMatched}/${itemNodes.length}개 항목에서 발견`);
              if (scoped.samples.length > 0) details.push(`  샘플: "${scoped.samples[0]}"`);
            } else if (scoped.itemMatched > 0) {
              details.push(`✗ parse_rules.${field} (${sel}): 일부 항목에서만 발견 (${scoped.itemMatched}/${itemNodes.length}, 최소 50% 필요)`);
              if (scoped.samples.length > 0) details.push(`  샘플: "${scoped.samples[0]}"`);
              hasErrors = true;
            } else {
              // 항목 내부에서 못 찾으면 상대 선택자일 수 있음 - 글로벌로 체크
              const global = checkSelectorGlobal($, sel);
              if (global.count >= MIN_GLOBAL) {
                foundCount++;
                details.push(`✓ parse_rules.${field} (${sel}): ${global.count}개 요소 발견 (전역)`);
                if (global.samples.length > 0) details.push(`  샘플: "${global.samples[0]}"`);
              } else if (global.count > 0) {
                details.push(`✗ parse_rules.${field} (${sel}): ${global.count}개만 발견 (최소 ${MIN_GLOBAL}개 필요, 헤더/푸터 영역일 가능성)`);
                if (global.samples.length > 0) details.push(`  샘플: "${global.samples[0]}"`);
                hasErrors = true;
              } else {
                details.push(`✗ parse_rules.${field} (${sel}): 요소를 찾을 수 없음`);
                hasErrors = true;
              }
            }
          }
        } catch (e: any) {
          details.push(`✗ parse_rules.${field} (${sel}): 선택자 오류 (${e.message})`);
          hasErrors = true;
        }
      }
    }
  }

  // pagination 설정 검증
  if (config.pagination) {
    const { type, selector, param } = config.pagination;
    if (type === "next_button" && selector) {
      try {
        const result = checkSelectorGlobal($, selector);
        if (result.found) {
          details.push(`✓ pagination.selector (${selector}): 다음 버튼 발견`);
        } else {
          details.push(`⚠ pagination.selector (${selector}): 다음 버튼을 찾을 수 없음 (마지막 페이지일 수 있음)`);
        }
      } catch {
        details.push(`⚠ pagination.selector (${selector}): 선택자 오류`);
      }
    } else if (type === "page_param" && param) {
      details.push(`✓ pagination: 페이지 파라미터 방식 (${param})`);
    }
  }

  // rendering 설정 확인
  if (config.rendering) {
    details.push(`ℹ rendering: ${config.rendering}`);
  }

  // 기본 검증 통과 여부
  if (details.length === 0) {
    details.push("⚠ 검증할 설정이 없습니다. parse_rules나 list 설정을 추가해주세요.");
    hasErrors = true;
  }

  // 요약 정보 추가
  if (totalCount > 0) {
    details.unshift(`📊 검증 결과: ${foundCount}/${totalCount}개 선택자 일치`);
  }

  // JavaScript 렌더링 필요 가능성 체크
  if (hasErrors && config.rendering === "static_html") {
    // HTML에 데이터가 거의 없는 경우 (스크립트로 로딩하는 SPA일 가능성)
    const textContent = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
    if (textContent.length < 1000) {
      details.push(`⚠ JavaScript 렌더링이 필요할 수 있습니다 (rendering: "dynamic_js" 시도 권장)`);
    }
  }

  return {
    success: !hasErrors,
    details,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const { list_url, web_config } = body;

    if (!list_url || typeof list_url !== "string") {
      return NextResponse.json({ error: "list_url이 필요합니다." }, { status: 400 });
    }

    if (!web_config || typeof web_config !== "object") {
      return NextResponse.json({ error: "web_config가 필요합니다." }, { status: 400 });
    }

    // URL에서 HTML 가져오기 (rendering 모드에 따라 fetch 또는 Puppeteer 사용)
    const rendering = (web_config as WebConfig).rendering;
    const htmlContent = await fetchUrlContent(list_url, rendering);

    // web_config 정합성 검증
    const validationResult = validateWebConfig(web_config, htmlContent);

    return NextResponse.json({
      success: validationResult.success,
      message: validationResult.success
        ? "web_config 설정이 유효합니다. 실제 스크래핑 시 데이터 수집이 가능할 것으로 예상됩니다."
        : "일부 설정에서 문제가 발견되었습니다. 선택자를 확인해주세요.",
      details: validationResult.details,
    });
  } catch (err: any) {
    console.error("[test-web-config] Error:", err);
    return NextResponse.json(
      { error: err.message || "테스트 실패" },
      { status: 500 }
    );
  }
}
