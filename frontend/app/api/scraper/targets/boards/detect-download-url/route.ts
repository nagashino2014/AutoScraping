import { NextResponse } from "next/server";
import { chromium, type Browser, type Page, type BrowserContext } from "playwright";

/**
 * 실제 클릭 기반 다운로드 URL 자동 감지
 * 
 * 혁신된 작동 방식:
 * 1. 목록 페이지에서 게시글 링크 탐지 (범용 방식)
 * 2. 상세 페이지 접속 후 첨부파일 영역 탐지
 * 3. CDP(Chrome DevTools Protocol)로 네트워크 모니터링 시작
 * 4. 다운로드 버튼을 실제로 클릭
 * 5. 발생한 다운로드 요청 URL 캡처
 * 6. URL 패턴 자동 분석 및 반환
 * 
 * 이 방식은 어떤 사이트든 다운로드 버튼만 있으면 URL 패턴을 자동 감지할 수 있음
 */

interface DetectedDownloadInfo {
  success: boolean;
  download_url?: string;
  url_pattern?: string;
  filename?: string;
  content_type?: string;
  onclick_pattern?: string;
  tried_articles?: number;
  article_with_attachment?: string;
  detected_selectors?: string[];
  error?: string;
  logs: string[];
}

interface CapturedDownload {
  url: string;
  method: string;
  headers?: Record<string, string>;
  filename?: string;
  contentType?: string;
  postData?: string;
}

// ============================================================
// 범용 선택자 정의 (사이트 무관)
// ============================================================

// 게시글 링크를 찾기 위한 범용 선택자
const ARTICLE_SELECTORS = [
  // ============================================================
  // 한국전력공사(KEPCO) 전용 패턴 - 최우선
  // fn_Detail('boardMngNo', 'boardNo') 형식
  // ============================================================
  "a[href*='fn_Detail']",
  "a[onclick*='fn_Detail']",
  // 게시판 상세 링크 (boardView.do 등) - 우선순위 높음
  "a[href*='boardView.do']",
  "a[href*='BoardView.do']",
  "a[href*='prView.do']",        // pr 게시판
  "a[href*='newsView.do']",      // news 게시판
  // 테이블 기반 게시판
  "table tbody tr td a[href]",
  "table tbody tr td a[onclick]",
  "table tbody tr[onclick]",
  // 리스트 기반 게시판
  ".board-list li a[href]",
  ".list-wrap li a[href]",
  "ul.board li a[href]",
  // 제목/링크 클래스
  ".title a[href]",
  ".subject a[href]",
  "a.title[href]",
  "a.subject[href]",
  // 썸네일/카드 형식 게시판 (KEPCO 등)
  ".card-list a[href*='View']",
  ".thumb-list a[href*='View']",
  ".media-list a[href*='View']",
  ".gallery-list a[href*='View']",
  ".news-list a[href*='View']",
  ".pr-list a[href*='View']",
  "article a[href*='View']",
  ".item a[href*='View']",
  // 게시판 공통 선택자
  ".bbs_list a[href]",
  ".board_list a[href]",
  ".tb_list a[href]",
  "td.subject a[href]",
  "td.title a[href]",
  // 범용 onclick
  "a[onclick*='boardView']",     // KEPCO 등
  "a[onclick*='view']",
  "a[onclick*='View']",
  "a[onclick*='detail']",
  "a[onclick*='Detail']",
  "a[onclick*='read']",
  "a[onclick*='Read']",
  "a[onclick*='goView']",
  "a[onclick*='fnView']",
  "a[onclick*='fn_view']",
  // href 패턴 (View.do, view.do 등)
  "a[href*='View.do']",
  "a[href*='view.do']",
  "a[href*='detail']",
  "a[href*='read.do']",
  "a[href*='read']",
  // 정부사이트 게시글 ID 파라미터
  "a[href*='bcIdx']",
  "a[href*='nttId']",
  "a[href*='articleId']",
  "a[href*='boardId']",
  "a[href*='seq=']",
  "a[href*='idx=']",
  "a[href*='no=']",
  // 마지막: 너무 범용적인 패턴 (낮은 우선순위)
  "a[href*='view']",
  "a[href*='View']",
];

// 첨부파일/다운로드 버튼을 찾기 위한 범용 선택자
const DOWNLOAD_BUTTON_SELECTORS = [
  // ============================================================
  // 국립환경과학원(NIER) 전용 패턴 - 최우선
  // a.fileDownload[data-no][data-seq] 형식
  // ============================================================
  "a.fileDownload[data-no][data-seq]",
  // ============================================================
  // 한국전력공사(KEPCO) 전용 패턴
  // h4.detail-file-title 아래의 G_FILE.downloadFile 링크
  // ============================================================
  "a[href*='G_FILE.downloadFile']",
  "a[href*='G_FILE.downloadFilePath']",
  ".detail-file-wrap a",
  // 중소벤처기업부 등 전자정부프레임워크 (높은 우선순위)
  "a.btn.type_down",
  "a.type_down",
  "a[title='내려받기']",
  "a[href*='Download.do']",
  "a[href*='download.do']",
  "a[href*='filedown.do']",
  "a[href*='fileDown.do']",
  // 다운로드 관련 클래스/ID (정부사이트 공통)
  "a[class*='download']",
  "a[class*='down']",
  "a.btn_type.down",
  "a.btn_down",
  "a.down",
  "button[class*='download']",
  "button[class*='down']",
  "a[id*='download']",
  "a[class*='file']",
  "a[class*='attach']",
  // 파일 타입별 클래스 (한국에너지공단 등: hwp_file, pdf_file)
  "a[class*='_file']",
  "a.hwp_file", "a.pdf_file", "a.doc_file", "a.xls_file", "a.ppt_file",
  // href 패턴 (대소문자 모두)
  "a[href*='download']",
  "a[href*='Download']",
  "a[href*='fileDown']",
  "a[href*='FileDown']",
  "a[href*='filedown']",
  "a[href*='attach']",
  "a[href*='/down/']",
  "a[href*='streFileNm']",  // 중소벤처기업부 등
  "a[href*='bcIdx'][href*='cbIdx']",  // 중소벤처기업부 다운로드
  // onclick 패턴
  "a[onclick*='down']",
  "a[onclick*='Down']",
  "a[onclick*='download']",
  "a[onclick*='Download']",
  "a[onclick*='ajaxDownload']",  // 국립환경과학원
  "a[onclick*='fnZipFileDownload']",  // 국립환경과학원
  "button[onclick*='down']",
  "button[onclick*='Down']",
  "input[onclick*='fileDownload']",  // 산업통상자원부 등
  "input[onclick*='Download']",
  "a[onclick*='file']",
  "a[onclick*='File']",
  "a[onclick*='streFileNm']",  // 중소벤처기업부
  // 파일 확장자
  "a[href$='.pdf']",
  "a[href$='.hwp']",
  "a[href$='.hwpx']",
  "a[href$='.doc']",
  "a[href$='.docx']",
  "a[href$='.xls']",
  "a[href$='.xlsx']",
  "a[href$='.zip']",
  // 아이콘 포함 링크
  "a:has(img[src*='file'])",
  "a:has(img[src*='down'])",
  "a:has(img[src*='attach'])",
  "a:has(img[alt*='파일'])",
  "a:has(img[alt*='다운'])",
  // 첨부파일 영역 내 링크
  ".file-list a",
  ".attach-list a",
  ".file_list a",
  ".attach_list a",
  ".attachFile a",
  ".file-area a",
  ".attach-area a",
  ".file_box a",
  ".atch_file a",
  ".addfile a",
  // 정부사이트 공통 첨부파일 영역
  ".view_file a",
  ".fileList a",
  ".file_down a",
  "dl.file dd a",
  "div.file a",
  "li.file a",
];

// 텍스트 기반 다운로드 버튼 (별도 처리)
const DOWNLOAD_TEXT_PATTERNS = [
  "다운로드",
  "내려받기",
  "다운",
  "Down",
  "Download",
  "받기",
];

// 제외할 링크 패턴 (뷰어, 미리보기 등)
const EXCLUDED_PATTERNS = [
  /viewer/i,
  /preview/i,
  /바로보기/,
  /미리보기/,
  /refer/i,
];

// ============================================================
// 유틸리티 함수
// ============================================================

function log(logs: string[], level: string, message: string) {
  const prefix = level === "INFO" ? "[INFO]" : level === "WARN" ? "[WARN]" : level === "DEBUG" ? "[DEBUG]" : "[FAIL]";
  logs.push(`${prefix} ${message}`);
  console.log(`${prefix} ${message}`);
}

function isExcludedLink(href: string, text: string): boolean {
  const combined = `${href} ${text}`.toLowerCase();
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(combined));
}

function extractUrlPattern(url: string): string {
  try {
    const urlObj = new URL(url);
    let pattern = urlObj.pathname;
    
    // ID, 해시 등을 플레이스홀더로 대체
    pattern = pattern
      .replace(/\/[a-f0-9]{32}/gi, "/{hash}")  // 32자리 해시
      .replace(/\/[a-f0-9]{24}/gi, "/{hash}")  // 24자리 해시
      .replace(/\/\d+/g, "/{id}")              // 숫자 ID
      .replace(/\/[a-f0-9-]{36}/gi, "/{uuid}"); // UUID
    
    return pattern;
  } catch {
    return url;
  }
}

// ============================================================
// 메인 감지 로직
// ============================================================

async function detectDownloadUrl(
  listUrl: string,
  sampleArticleLinks?: string[]  // DOM 분석에서 미리 추출한 게시글 링크들
): Promise<DetectedDownloadInfo> {
  const logs: string[] = [];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  
  log(logs, "INFO", "🚀 실제 클릭 기반 다운로드 URL 자동 감지 시작");
  log(logs, "INFO", `목록 URL: ${listUrl}`);
  
  // DOM 분석에서 제공된 샘플 링크가 있으면 로그
  if (sampleArticleLinks && sampleArticleLinks.length > 0) {
    log(logs, "INFO", `📋 DOM 분석에서 제공된 샘플 게시글 링크: ${sampleArticleLinks.length}개`);
  }
  
  try {
    // 브라우저 시작
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      acceptDownloads: true,
    });
    
    const page = await context.newPage();
    
    // 1단계: 목록 페이지 접속 및 게시글 링크 수집
    log(logs, "INFO", "📋 1단계: 목록 페이지 접속 및 게시글 링크 수집");
    await page.goto(listUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // DOM 분석에서 제공된 샘플 링크가 있으면 우선 사용
    let articleLinks: string[] = [];
    
    if (sampleArticleLinks && sampleArticleLinks.length > 0) {
      // 샘플 링크 중 유효한 것만 필터링 (절대 URL로 변환)
      articleLinks = sampleArticleLinks
        .map(link => {
          if (!link) return "";
          if (link.startsWith("http")) return link;
          try {
            return new URL(link, listUrl).href;
          } catch {
            return "";
          }
        })
        .filter(link => link && !link.startsWith("javascript:") && !link.startsWith("#"));
      
      log(logs, "INFO", `DOM 분석에서 제공된 샘플 링크 사용: ${articleLinks.length}개`);
    }
    
    // 샘플 링크가 없거나 부족하면 직접 수집
    if (articleLinks.length < 3) {
      log(logs, "INFO", "추가 게시글 링크 수집 중...");
      const collectedLinks = await collectArticleLinks(page, listUrl, logs);
      
      // 중복 제거하여 병합
      const seenUrls = new Set(articleLinks);
      for (const link of collectedLinks) {
        if (!seenUrls.has(link)) {
          articleLinks.push(link);
          seenUrls.add(link);
        }
      }
    }
    
    if (articleLinks.length === 0) {
      log(logs, "FAIL", "게시글 링크를 찾지 못했습니다.");
      return { success: false, error: "게시글 링크를 찾지 못했습니다.", logs };
    }
    
    log(logs, "INFO", `총 발견된 게시글: ${articleLinks.length}개`);
    
    // 2단계: 최대 5개 게시글에서 다운로드 URL 감지 시도
    const maxTries = Math.min(5, articleLinks.length);
    log(logs, "INFO", `📄 2단계: 최대 ${maxTries}개 게시글에서 다운로드 URL 감지 시도`);
    
    for (let i = 0; i < maxTries; i++) {
      const articleUrl = articleLinks[i];
      log(logs, "INFO", `=== 게시글 ${i + 1}/${maxTries} 시도 ===`);
      log(logs, "INFO", `URL: ${articleUrl.slice(0, 80)}...`);
      
      try {
        // 상세 페이지 접속 (느린 사이트를 위해 60초 타임아웃)
        await page.goto(articleUrl, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(2000);
        
        // 첨부파일 영역이 동적 로드되는 경우를 위해 추가 대기
        // NIER, 전자정부 프레임워크 등 다양한 첨부파일 선택자 대기
        try {
          await page.waitForSelector(
            "a.fileDownload, ul.file-atch-list, .file_info, .fileAttach, a[href*='download'], a[onclick*='download']",
            { timeout: 5000 }
          );
          log(logs, "DEBUG", "첨부파일 영역 감지됨");
        } catch {
          log(logs, "DEBUG", "첨부파일 영역 대기 타임아웃 (계속 진행)");
        }
        
        // 다운로드 버튼 탐지 및 클릭
        const result = await detectAndClickDownload(page, context, articleUrl, logs);
        
        if (result.success && result.download_url) {
          log(logs, "INFO", `✅ 다운로드 URL 감지 성공!`);
          log(logs, "INFO", `URL: ${result.download_url}`);
          log(logs, "INFO", `패턴: ${result.url_pattern}`);
          
          return {
            success: true,
            download_url: result.download_url,
            url_pattern: result.url_pattern,
            filename: result.filename,
            content_type: result.contentType,
            onclick_pattern: result.onclickPattern,
            tried_articles: i + 1,
            article_with_attachment: articleUrl,
            detected_selectors: result.detectedSelectors,
            logs,
          };
        }
        
        log(logs, "INFO", "이 게시글에서는 다운로드 URL을 찾지 못함, 다음 게시글 시도...");
        
      } catch (err) {
        log(logs, "WARN", `게시글 접근 오류: ${err}`);
      }
    }
    
    log(logs, "FAIL", `${maxTries}개의 게시글에서 다운로드 URL을 감지하지 못했습니다.`);
    return {
      success: false,
      error: `${maxTries}개의 게시글에서 다운로드 URL을 감지하지 못했습니다.`,
      tried_articles: maxTries,
      logs,
    };
    
  } catch (err) {
    log(logs, "FAIL", `오류 발생: ${err}`);
    return {
      success: false,
      error: String(err),
      logs,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// ============================================================
// 게시글 링크 수집
// ============================================================

async function collectArticleLinks(page: Page, baseUrl: string, logs: string[]): Promise<string[]> {
  const links: string[] = [];
  const seenUrls = new Set<string>();
  const baseUrlObj = new URL(baseUrl);
  
  // 페이지 로드 대기
  await page.waitForLoadState("networkidle").catch(() => {});
  
  // 디버그: 페이지 내 모든 링크 개수 확인
  const allLinks = await page.$$eval("a[href]", els => els.length);
  log(logs, "DEBUG", `페이지 내 총 링크 개수: ${allLinks}개`);
  
  for (const selector of ARTICLE_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      
      if (elements.length > 0) {
        log(logs, "DEBUG", `선택자 "${selector}": ${elements.length}개 요소 발견`);
      }
      
      for (const el of elements) {
        try {
          // href 또는 onclick에서 URL 추출
          let href = await el.getAttribute("href");
          const onclick = await el.getAttribute("onclick") || "";
          const text = (await el.textContent() || "").trim().slice(0, 30);
          
          // KEPCO 패턴: href 자체가 javascript:fn_Detail('15','3014') 형식인 경우
          if (href && href.includes("fn_Detail")) {
            const extractedUrl = extractUrlFromOnclick(href, baseUrlObj);
            if (extractedUrl) {
              href = extractedUrl;
              log(logs, "DEBUG", `fn_Detail 패턴에서 URL 추출: ${extractedUrl.slice(0,60)}...`);
            }
          }
          // onclick에서 URL 추출 시도
          else if (!href || href === "#" || href.startsWith("javascript:")) {
            const extractedUrl = extractUrlFromOnclick(onclick, baseUrlObj);
            if (extractedUrl) href = extractedUrl;
          }
          
          if (!href || href === "#" || href.startsWith("javascript:")) continue;
          
          // 절대 URL로 변환
          let fullUrl = href.startsWith("http") ? href : new URL(href, baseUrl).href;
          
          // 국립환경과학원(NIER) 상세 페이지 보정
          // comBbsView.do?ntIdx=... → comBbsDetail.do?pstNo=...
          if (fullUrl.includes("/common/kor/board/comBbsView.do")) {
            try {
              const detailUrl = new URL(fullUrl);
              detailUrl.pathname = detailUrl.pathname.replace("comBbsView.do", "comBbsDetail.do");
              const ntIdx = detailUrl.searchParams.get("ntIdx");
              if (ntIdx && !detailUrl.searchParams.get("pstNo")) {
                detailUrl.searchParams.set("pstNo", ntIdx);
              }
              detailUrl.searchParams.delete("ntIdx");
              fullUrl = detailUrl.href;
            } catch {
              // 변환 실패 시 원본 유지
            }
          }
          
          // 중복 검사
          if (seenUrls.has(fullUrl)) continue;
          
          // 유효성 검사
          if (!isValidArticleLink(fullUrl, baseUrl, text)) {
            // 디버그: 왜 제외되었는지 첫 번째 것만 로그
            if (links.length === 0 && seenUrls.size < 3) {
              log(logs, "DEBUG", `제외된 링크: ${fullUrl.slice(0, 80)}... (텍스트: ${text})`);
            }
            continue;
          }
          
          seenUrls.add(fullUrl);
          links.push(fullUrl);
          
          // 첫 번째 유효한 링크 로그
          if (links.length === 1) {
            log(logs, "DEBUG", `첫 번째 유효 링크: ${fullUrl.slice(0, 80)}...`);
          }
          
        } catch {
          // 개별 요소 오류 무시
        }
      }
      
      if (links.length >= 10) break;
      
    } catch {
      // 선택자 오류 무시
    }
  }
  
  log(logs, "DEBUG", `수집된 게시글 링크: ${links.length}개`);
  return links.slice(0, 10);
}

function extractUrlFromOnclick(onclick: string, baseUrl: URL): string | null {
  if (!onclick) return null;
  
  // ============================================================
  // 한국전력공사(KEPCO) 전용 패턴 - 최우선
  // G_FILE.downloadFile(atchFileId, fileSn, 'fileName')
  // G_FILE.downloadFilePath('path', 'fileName')
  // ============================================================
  const kepcoDownloadMatch = onclick.match(/G_FILE\.downloadFile\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/i);
  if (kepcoDownloadMatch) {
    const atchFileId = kepcoDownloadMatch[1];
    const fileSn = kepcoDownloadMatch[2];
    return `kepco:/portal/fileDown/download.do|atchFileId=${atchFileId}&fileSn=${fileSn}`;
  }
  
  const kepcoFilePathMatch = onclick.match(/G_FILE\.downloadFilePath\s*\(\s*['"]([^'"]+)['"]/i);
  if (kepcoFilePathMatch) {
    const filePath = kepcoFilePathMatch[1];
    return filePath.startsWith("/") ? filePath : `/${filePath}`;
  }
  
  // 한국전력공사(KEPCO) 게시글 링크 패턴: fn_Detail('boardMngNo', 'boardNo')
  // URL: /home/media/newsroom/pr/boardView.do?boardMngNo=15&boardNo=3014
  const kepcoDetailMatch = onclick.match(/fn_Detail\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/i);
  if (kepcoDetailMatch) {
    const boardMngNo = kepcoDetailMatch[1];
    const boardNo = kepcoDetailMatch[2];
    // boardList.do → boardView.do 변환
    let basePath = baseUrl.pathname;
    if (basePath.includes("List.do") || basePath.includes("list.do")) {
      basePath = basePath.replace(/[Ll]ist\.do/, "View.do");
    } else {
      basePath = basePath.replace(/\/?$/, "/boardView.do");
    }
    return `${basePath}?boardMngNo=${boardMngNo}&boardNo=${boardNo}`;
  }
  
  // 패턴 1: location.href='...'
  const hrefMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
  if (hrefMatch?.[1]) return hrefMatch[1];
  
  // 패턴 2: window.open('...')
  const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
  if (openMatch?.[1]) return openMatch[1];
  
  // 패턴 3: doBbsFView('cbIdx', 'bcIdx', ...) - 중소벤처기업부 등 전자정부프레임워크 (먼저 처리!)
  const bbsFViewMatch = onclick.match(/doBbsFView\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/i);
  if (bbsFViewMatch) {
    const cbIdx = bbsFViewMatch[1];
    const bcIdx = bbsFViewMatch[2];
    // /site/smba/ex/bbs/List.do → /site/smba/ex/bbs/View.do
    let basePath = baseUrl.pathname;
    if (basePath.includes("List.do")) {
      basePath = basePath.replace("List.do", "View.do");
    } else if (basePath.includes("list.do")) {
      basePath = basePath.replace("list.do", "View.do");
    } else {
      basePath = basePath.replace(/\/?$/, "/View.do");
    }
    return `${basePath}?cbIdx=${cbIdx}&bcIdx=${bcIdx}`;
  }
  
  // 패턴 4: doBbsView('boardId', 'idx') - 일반 전자정부 게시판
  const bbsViewMatch = onclick.match(/doBbsView\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?/i);
  if (bbsViewMatch) {
    const boardId = bbsViewMatch[1];
    const idx = bbsViewMatch[2];
    let basePath = baseUrl.pathname;
    if (basePath.includes("List.do")) {
      basePath = basePath.replace("List.do", "View.do");
    } else if (basePath.includes("list.do")) {
      basePath = basePath.replace("list.do", "View.do");
    }
    return `${basePath}?boardId=${boardId}&idx=${idx}`;
  }
  
  // 패턴 5: article.view('id') - 산업통상부
  const articleMatch = onclick.match(/article\.view\s*\(\s*['"](\d+)['"]/i);
  if (articleMatch?.[1]) {
    return `${baseUrl.pathname}/${articleMatch[1]}/view`;
  }
  
  // 패턴 6: fn_egov_inqire_notice('id') - 기획재정부
  const egovMatch = onclick.match(/fn_egov_inqire_notice\s*\(\s*['"](\d+)['"]/i);
  if (egovMatch?.[1]) {
    const bbsId = baseUrl.searchParams.get("bbsId");
    const menuNo = baseUrl.searchParams.get("menuNo");
    const basePath = baseUrl.pathname.replace(/\.do.*$/, "View.do");
    return `${basePath}?bbsId=${bbsId || ""}&nttSn=${egovMatch[1]}${menuNo ? `&menuNo=${menuNo}` : ""}`;
  }
  
  // 패턴 7: fnMoveDetail('id', this) - 국립환경과학원 등
  const moveDetailMatch = onclick.match(/fnMoveDetail\s*\(\s*['"](\d+)['"]/i);
  if (moveDetailMatch?.[1]) {
    const ntIdx = moveDetailMatch[1];
    const bbsNo = baseUrl.searchParams.get("bbsNo") || "";
    const menuNo = baseUrl.searchParams.get("menuNo") || "";
    // comBbsList.do → comBbsDetail.do (NIER 상세 페이지)
    let basePath = baseUrl.pathname;
    if (basePath.includes("List.do")) {
      basePath = basePath.replace("List.do", "Detail.do");
    } else if (basePath.includes("list.do")) {
      basePath = basePath.replace("list.do", "Detail.do");
    }
    return `${basePath}?bbsNo=${bbsNo}&pstNo=${ntIdx}${menuNo ? `&menuNo=${menuNo}` : ""}`;
  }
  
  // 패턴 8: goToDetail('id'), fnDetail('id'), fnView('id') - 일반적인 상세 이동
  const detailFnMatch = onclick.match(/(?:goTo|fn)(?:Detail|View)\s*\(\s*['"]?(\d+)['"]?/i);
  if (detailFnMatch?.[1]) {
    const id = detailFnMatch[1];
    let basePath = baseUrl.pathname;
    if (basePath.includes("List.do")) {
      basePath = basePath.replace("List.do", "View.do");
    } else if (basePath.includes("list.do")) {
      basePath = basePath.replace("list.do", "View.do");
    }
    return `${basePath}?seq=${id}`;
  }
  
  // 패턴 9: goView('id'), fn_view('id'), etc. (일반적인 패턴 - 마지막에 처리)
  const viewMatch = onclick.match(/(?:go|fn_?)(?:view|detail|read)\s*\(\s*['"]?(\d+)['"]?/i);
  if (viewMatch?.[1]) {
    const path = baseUrl.pathname;
    if (path.includes("/list")) {
      return path.replace("/list", "/view") + `?seq=${viewMatch[1]}`;
    }
    return `${path}/${viewMatch[1]}/view`;
  }
  
  return null;
}

function isValidArticleLink(url: string, baseUrl: string, text: string): boolean {
  try {
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    
    // 같은 도메인인지 확인
    if (urlObj.hostname !== baseUrlObj.hostname) return false;
    
    // 메인 페이지, 루트 경로 제외
    if (urlObj.pathname === "/" || urlObj.pathname === baseUrlObj.pathname) return false;
    
    // 메뉴, 로그인, 소개 페이지 등 제외 (pathname만 검사)
    const pathExcludePatterns = [
      /\/login/i,
      /\/menu\//i,
      /\/menu\./i,
      /\/sitemap/i,
      /\/privacy/i,
      /\/footer/i,
      // 메뉴/소개 페이지 패턴 추가
      /overview\.do$/i,         // overview.do (메뉴 페이지)
      /\/about\//i,             // /about/ 경로
      /\/introduce\//i,         // /introduce/ 경로
      /\/disclosure\//i,        // /disclosure/ (공시 메뉴)
      /\/esg\//i,               // /esg/ (ESG 메뉴)
      /\/service\/.*\/conts\.do$/i,  // 정적 콘텐츠 페이지
      /conts\.do$/i,            // conts.do (콘텐츠 페이지)
    ];
    
    if (pathExcludePatterns.some(p => p.test(urlObj.pathname))) return false;
    
    // 목록 페이지와 동일한 경로 구조의 View 페이지만 허용
    // 예: boardList.do -> boardView.do
    const basePath = baseUrlObj.pathname;
    const urlPath = urlObj.pathname;
    
    // boardList.do에서 boardView.do로의 패턴 확인
    if (basePath.includes("List.do") || basePath.includes("list.do")) {
      const viewPattern = basePath.replace(/[Ll]ist\.do$/, "[Vv]iew\\.do");
      const viewRegex = new RegExp(viewPattern);
      if (viewRegex.test(urlPath)) {
        return true;  // 같은 게시판의 View 페이지면 허용
      }
    }
    
    // 텍스트에서 메뉴 관련 키워드 제외
    const textExcludePatterns = [
      /^(메뉴|로그인|사이트맵|개인정보|이용약관|회사소개|기관소개|관련사이트|전국사업소)$/i
    ];
    if (textExcludePatterns.some(p => p.test(text.trim()))) return false;
    
    // 텍스트가 너무 짧거나 없으면 제외 (메뉴 버튼일 가능성 높음)
    if (text.trim().length < 3) return false;
    
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// 다운로드 버튼 탐지 및 클릭 (핵심 로직)
// ============================================================

interface DetectResult {
  success: boolean;
  download_url?: string;
  url_pattern?: string;
  filename?: string;
  contentType?: string;
  onclickPattern?: string;
  detectedSelectors?: string[];
}

async function detectAndClickDownload(
  page: Page,
  context: BrowserContext,
  articleUrl: string,
  logs: string[]
): Promise<DetectResult> {
  
  // 캡처할 다운로드 정보
  const capturedDownloads: CapturedDownload[] = [];
  const detectedSelectors: string[] = [];
  
  // CDP 세션으로 네트워크 모니터링 설정
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  
  // 네트워크 요청 캡처
  client.on("Network.requestWillBeSent", (params: any) => {
    const url = params.request.url;
    const method = params.request.method;
    const headers = params.request.headers;
    
    // 다운로드 관련 URL 패턴 감지
    if (isDownloadRequest(url, params.type)) {
      log(logs, "DEBUG", `📡 다운로드 요청 캡처: ${url.slice(0, 100)}...`);
      capturedDownloads.push({
        url,
        method,
        headers,
        postData: params.request.postData,
      });
    }
  });
  
  // 응답 헤더에서 Content-Disposition 캡처
  client.on("Network.responseReceived", (params: any) => {
    const headers = params.response.headers;
    const contentDisposition = headers["Content-Disposition"] || headers["content-disposition"];
    const contentType = headers["Content-Type"] || headers["content-type"];
    
    if (contentDisposition && contentDisposition.includes("attachment")) {
      const url = params.response.url;
      log(logs, "DEBUG", `📦 다운로드 응답 캡처: ${url.slice(0, 100)}...`);
      
      // 파일명 추출
      const filenameMatch = contentDisposition.match(/filename[*]?=['"]?([^'";]+)/i);
      const filename = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1]) : undefined;
      
      const existing = capturedDownloads.find(d => d.url === url);
      if (existing) {
        existing.filename = filename;
        existing.contentType = contentType;
      } else {
        capturedDownloads.push({ url, method: "GET", filename, contentType });
      }
    }
  });
  
  // download 이벤트 캡처
  page.on("download", async (download) => {
    const url = download.url();
    const filename = download.suggestedFilename();
    log(logs, "DEBUG", `⬇️ 다운로드 이벤트: ${filename} (${url.slice(0, 80)}...)`);
    
    capturedDownloads.push({ url, method: "GET", filename });
    
    // 다운로드 취소 (실제로 파일 저장 안 함)
    await download.cancel().catch(() => {});
  });
  
  // 다운로드 버튼 찾기 및 분석
  log(logs, "DEBUG", "🔍 다운로드 버튼 탐색 중...");
  
  // NIER 전용 디버그: fileDownload 클래스 요소 확인
  try {
    const nierElements = await page.$$("a.fileDownload");
    log(logs, "DEBUG", `NIER a.fileDownload 요소: ${nierElements.length}개`);
    for (let i = 0; i < Math.min(3, nierElements.length); i++) {
      const el = nierElements[i];
      const attrs = await el.evaluate((e: Element) => ({
        href: e.getAttribute("href"),
        class: e.getAttribute("class"),
        dataNo: e.getAttribute("data-no"),
        dataSeq: e.getAttribute("data-seq"),
        text: e.textContent?.slice(0, 50)
      }));
      log(logs, "DEBUG", `  [${i}] href="${attrs.href}", data-no="${attrs.dataNo}", data-seq="${attrs.dataSeq}", text="${attrs.text}"`);
    }
  } catch (e) {
    log(logs, "DEBUG", `NIER 디버그 실패: ${e}`);
  }
  
  let downloadButtons: Array<{ element: any; selector: string; href: string; onclick: string; text: string; dataNo?: string; dataSeq?: string }> = [];
  
  // 1. CSS 선택자 기반 탐색
  for (const selector of DOWNLOAD_BUTTON_SELECTORS) {
    try {
      const elements = await page.$$(selector);
      
      for (const el of elements) {
        const href = await el.getAttribute("href") || "";
        const onclick = await el.getAttribute("onclick") || "";
        const text = (await el.textContent() || "").trim();
        // 국립환경과학원(NIER) data-no, data-seq 속성 추출
        const dataNo = await el.getAttribute("data-no") || "";
        const dataSeq = await el.getAttribute("data-seq") || "";
        
        // 뷰어/미리보기 제외
        if (isExcludedLink(href, text)) continue;
        
        // 다운로드 가능한 요소인지 확인 (data-no/data-seq가 있으면 다운로드 버튼으로 처리)
        if (href || onclick || (dataNo && dataSeq)) {
          downloadButtons.push({ element: el, selector, href, onclick, text, dataNo, dataSeq });
          if (!detectedSelectors.includes(selector)) {
            detectedSelectors.push(selector);
          }
        }
      }
      
    } catch {
      // 선택자 오류 무시
    }
  }
  
  // 2. 텍스트 기반 탐색 ("내려받기", "다운로드" 등)
  for (const textPattern of DOWNLOAD_TEXT_PATTERNS) {
    try {
      // 텍스트가 포함된 a, button 요소 찾기
      const elements = await page.$$(`a:has-text("${textPattern}"), button:has-text("${textPattern}")`);
      
      for (const el of elements) {
        const href = await el.getAttribute("href") || "";
        const onclick = await el.getAttribute("onclick") || "";
        const text = (await el.textContent() || "").trim();
        
        if (isExcludedLink(href, text)) continue;
        
        // 이미 추가된 요소가 아닌 경우에만 추가
        const isDuplicate = downloadButtons.some(btn => 
          btn.href === href && btn.onclick === onclick && btn.text === text
        );
        
        if (!isDuplicate && (href || onclick)) {
          downloadButtons.push({ element: el, selector: `text:${textPattern}`, href, onclick, text });
          log(logs, "DEBUG", `텍스트 "${textPattern}"로 버튼 발견: ${text.slice(0, 30)}`);
        }
      }
    } catch {
      // 텍스트 선택자 오류 무시
    }
  }
  
  // 3. 페이지 내 모든 a, button 요소에서 다운로드 관련 속성 검사
  try {
    const allLinks = await page.$$("a[onclick], button[onclick]");
    for (const el of allLinks) {
      const onclick = await el.getAttribute("onclick") || "";
      const href = await el.getAttribute("href") || "";
      const text = (await el.textContent() || "").trim();
      
      // onclick에 다운로드 관련 키워드가 있는지 확인
      const onclickLower = onclick.toLowerCase();
      if (onclickLower.includes("down") || onclickLower.includes("file") || 
          onclickLower.includes("attach") || onclickLower.includes("strefilen")) {
        
        if (isExcludedLink(href, text)) continue;
        
        const isDuplicate = downloadButtons.some(btn => 
          btn.onclick === onclick && btn.text === text
        );
        
        if (!isDuplicate) {
          downloadButtons.push({ element: el, selector: "onclick-scan", href, onclick, text });
          log(logs, "DEBUG", `onclick 스캔으로 발견: ${text.slice(0, 30)}, onclick=${onclick.slice(0, 50)}`);
        }
      }
    }
  } catch {
    // 전체 스캔 오류 무시
  }
  
  // 4. 첨부파일 영역 텍스트로도 탐색
  const attachmentArea = await findAttachmentArea(page, logs);
  if (attachmentArea) {
    const areaButtons = await attachmentArea.$$("a, button");
    for (const el of areaButtons) {
      const href = await el.getAttribute("href") || "";
      const onclick = await el.getAttribute("onclick") || "";
      const text = (await el.textContent() || "").trim();
      
      if (isExcludedLink(href, text)) continue;
      
      const isDuplicate = downloadButtons.some(btn => 
        btn.href === href && btn.onclick === onclick
      );
      
      if (!isDuplicate && (href || onclick)) {
        downloadButtons.push({ element: el, selector: "attachment-area", href, onclick, text });
      }
    }
  }
  
  log(logs, "INFO", `다운로드 버튼 후보: ${downloadButtons.length}개`);
  
  // 발견된 버튼들의 정보 로깅
  for (let i = 0; i < Math.min(5, downloadButtons.length); i++) {
    const btn = downloadButtons[i];
    log(logs, "DEBUG", `버튼[${i}]: text="${btn.text.slice(0, 20)}", selector=${btn.selector}, onclick="${btn.onclick.slice(0, 40)}..."`);
  }
  
  if (downloadButtons.length === 0) {
    log(logs, "WARN", "다운로드 버튼을 찾지 못함");
    await client.detach().catch(() => {});
    return { success: false };
  }
  
  // 첫 번째 버튼 클릭 시도
  for (let i = 0; i < Math.min(3, downloadButtons.length); i++) {
    const btn = downloadButtons[i];
    log(logs, "DEBUG", `버튼 ${i + 1} 클릭 시도: text="${btn.text.slice(0, 30)}", onclick="${btn.onclick.slice(0, 50)}..."`);
    
    try {
      // ============================================================
      // 국립환경과학원(NIER) data-no, data-seq 속성 기반 URL 생성
      // ============================================================
      if (btn.dataNo && btn.dataSeq) {
        // NIER POST 방식 다운로드: atchFileNo, atchFileSeq 파라미터 사용
        const downloadUrl = `post:/common/comDownloadFile.do|atchFileNo=${btn.dataNo}&atchFileSeq=${btn.dataSeq}`;
        log(logs, "INFO", `✅ NIER POST 다운로드 URL 생성!`);
        
        await client.detach().catch(() => {});
        
        return {
          success: true,
          download_url: downloadUrl,
          url_pattern: "post:/common/comDownloadFile.do|atchFileNo={no}&atchFileSeq={seq}",
          onclickPattern: "a.fileDownload[data-no][data-seq]",
          detectedSelectors,
        };
      }
      
      // 클릭 전 캡처 초기화
      capturedDownloads.length = 0;
      
      // 클릭
      await btn.element.click({ timeout: 5000 }).catch(async () => {
        // click 실패 시 JavaScript로 직접 클릭
        await page.evaluate((el: any) => el.click(), btn.element);
      });
      
      // 다운로드 요청 대기 (최대 5초)
      await page.waitForTimeout(3000);
      
      // 캡처된 다운로드 확인
      if (capturedDownloads.length > 0) {
        const captured = capturedDownloads[0];
        log(logs, "INFO", `✅ 다운로드 URL 캡처 성공!`);
        
        await client.detach().catch(() => {});
        
        return {
          success: true,
          download_url: captured.url,
          url_pattern: extractUrlPattern(captured.url),
          filename: captured.filename,
          contentType: captured.contentType,
          onclickPattern: btn.onclick ? extractOnclickPattern(btn.onclick) : undefined,
          detectedSelectors,
        };
      }
      
      // href가 직접 다운로드 URL인 경우
      if (btn.href && !btn.href.startsWith("javascript:") && btn.href !== "#") {
        const fullUrl = btn.href.startsWith("http") ? btn.href : new URL(btn.href, articleUrl).href;
        
        if (isLikelyDownloadUrl(fullUrl)) {
          log(logs, "INFO", `✅ href에서 다운로드 URL 감지!`);
          
          await client.detach().catch(() => {});
          
          return {
            success: true,
            download_url: fullUrl,
            url_pattern: extractUrlPattern(fullUrl),
            onclickPattern: btn.onclick ? extractOnclickPattern(btn.onclick) : undefined,
            detectedSelectors,
          };
        }
      }
      
      // onclick에서 URL 추출 시도
      if (btn.onclick) {
        const extractedUrl = extractDownloadUrlFromOnclick(btn.onclick, articleUrl);
        if (extractedUrl) {
          log(logs, "INFO", `✅ onclick에서 다운로드 URL 추출!`);
          
          await client.detach().catch(() => {});
          
          return {
            success: true,
            download_url: extractedUrl,
            url_pattern: extractUrlPattern(extractedUrl),
            onclickPattern: extractOnclickPattern(btn.onclick),
            detectedSelectors,
          };
        }
      }
      
    } catch (clickErr) {
      log(logs, "DEBUG", `클릭 오류: ${clickErr}`);
    }
    
    // 페이지 새로고침 (다음 버튼 시도를 위해)
    if (i < downloadButtons.length - 1) {
      await page.goto(articleUrl, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1000);
      
      // 버튼 다시 찾기
      downloadButtons = [];
      for (const selector of DOWNLOAD_BUTTON_SELECTORS) {
        try {
          const elements = await page.$$(selector);
          for (const el of elements) {
            const href = await el.getAttribute("href") || "";
            const onclick = await el.getAttribute("onclick") || "";
            const text = (await el.textContent() || "").trim();
            if (!isExcludedLink(href, text) && (href || onclick)) {
              downloadButtons.push({ element: el, selector, href, onclick, text });
            }
          }
        } catch {}
      }
    }
  }
  
  await client.detach().catch(() => {});
  return { success: false, detectedSelectors };
}

// ============================================================
// 헬퍼 함수들
// ============================================================

function isDownloadRequest(url: string, type?: string): boolean {
  const lowerUrl = url.toLowerCase();
  
  // 다운로드 관련 URL 패턴 (항상 체크)
  const downloadPatterns = [
    /download\.do/i,
    /download/i,
    /filedown/i,
    /attach.*down/i,
    /\/down\//i,
    /getfile/i,
    /strefilenm/i,  // 중소벤처기업부 등
    /\.pdf(\?|$)/i,
    /\.hwp(\?|$)/i,
    /\.hwpx(\?|$)/i,
    /\.doc(\?|$)/i,
    /\.docx(\?|$)/i,
    /\.xls(\?|$)/i,
    /\.xlsx(\?|$)/i,
    /\.zip(\?|$)/i,
  ];
  
  // 리소스 타입이 Document, XHR, Fetch인 경우 또는 타입 정보 없는 경우
  if (!type || type === "Document" || type === "XHR" || type === "Fetch") {
    return downloadPatterns.some(p => p.test(lowerUrl));
  }
  
  return false;
}

function isLikelyDownloadUrl(url: string): boolean {
  const patterns = [
    /download\.do/i,
    /download/i,
    /filedown/i,
    /attach.*down/i,
    /\/down\//i,
    /getfile/i,
    /strefilenm/i,
    /\.pdf(\?|$)/i,
    /\.hwp(\?|$)/i,
    /\.hwpx(\?|$)/i,
    /\.doc(\?|$)/i,
    /\.docx(\?|$)/i,
    /\.xls(\?|$)/i,
    /\.xlsx(\?|$)/i,
    /\.zip(\?|$)/i,
  ];
  
  return patterns.some(p => p.test(url));
}

function extractDownloadUrlFromOnclick(onclick: string, baseUrl: string): string | null {
  try {
    const baseUrlObj = new URL(baseUrl);
    
    // 패턴 1: location.href='/...'
    const hrefMatch = onclick.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i);
    if (hrefMatch?.[1]) {
      return hrefMatch[1].startsWith("http") ? hrefMatch[1] : new URL(hrefMatch[1], baseUrl).href;
    }
    
    // 패턴 2: window.open('...')
    const openMatch = onclick.match(/window\.open\s*\(\s*['"]([^'"]+)['"]/i);
    if (openMatch?.[1] && isLikelyDownloadUrl(openMatch[1])) {
      return openMatch[1].startsWith("http") ? openMatch[1] : new URL(openMatch[1], baseUrl).href;
    }
    
    // 패턴 3: fn_fileDown('hash1','hash2','hash3') - 산업통상부
    const fileDownMatch = onclick.match(/fn_fileDown\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/i);
    if (fileDownMatch) {
      return `${baseUrlObj.origin}/attach/down/${fileDownMatch[1]}/${fileDownMatch[2]}/${fileDownMatch[3]}`;
    }
    
    // 패턴 4: fileDownload('path') 또는 fileDownload('streFileNm', 'bcIdx')
    const fileDownloadMatch = onclick.match(/file[Dd]ownload\s*\(\s*['"]([^'"]+)['"]/i);
    if (fileDownloadMatch?.[1]) {
      const path = fileDownloadMatch[1];
      if (path.startsWith("http") || path.startsWith("/")) {
        return path.startsWith("http") ? path : new URL(path, baseUrl).href;
      }
    }
    
    // 패턴 5: downloadFile(id, filename)
    const downloadFileMatch = onclick.match(/downloadFile\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]([^'"]+)['"]/i);
    if (downloadFileMatch) {
      return `${baseUrlObj.origin}/download?id=${downloadFileMatch[1]}&filename=${encodeURIComponent(downloadFileMatch[2])}`;
    }
    
    // 패턴 6: fn_egov_downFile('streFileNm', 'orignFileNm', 'cbIdx', 'bcIdx') - 중소벤처기업부 등
    const egovDownMatch = onclick.match(/fn_egov_downFile\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/i);
    if (egovDownMatch) {
      return `${baseUrlObj.origin}/common/board/Download.do?bcIdx=${egovDownMatch[4]}&cbIdx=${egovDownMatch[3]}&streFileNm=${egovDownMatch[1]}`;
    }
    
    // 패턴 7: Download.do URL 직접 구성 (streFileNm 파라미터)
    const streFileMatch = onclick.match(/['"]([^'"]*streFileNm[^'"]*)['"]/i);
    if (streFileMatch?.[1]) {
      return streFileMatch[1].startsWith("http") ? streFileMatch[1] : new URL(streFileMatch[1], baseUrl).href;
    }
    
    // 패턴 8: jsDownload, fnDownload 등 범용 다운로드 함수
    const genericDownMatch = onclick.match(/(?:js|fn|do)?[Dd]ownload\s*\(\s*['"]([^'"]+)['"]/i);
    if (genericDownMatch?.[1]) {
      const path = genericDownMatch[1];
      if (path.includes("/") || path.includes("Download") || path.includes("download")) {
        return path.startsWith("http") ? path : new URL(path, baseUrl).href;
      }
    }
    
    // 패턴 9: onclick에서 직접 URL 추출 (Download.do, download 등 포함)
    const urlMatch = onclick.match(/['"]([^'"]*(?:Download\.do|download|fileDown)[^'"]*)['"]/i);
    if (urlMatch?.[1]) {
      return urlMatch[1].startsWith("http") ? urlMatch[1] : new URL(urlMatch[1], baseUrl).href;
    }
    
    return null;
  } catch {
    return null;
  }
}

function extractOnclickPattern(onclick: string): string {
  // 함수명과 파라미터 구조 추출
  const match = onclick.match(/(\w+)\s*\(([^)]*)\)/);
  if (match) {
    const fnName = match[1];
    const params = match[2].split(",").map(p => p.trim());
    const paramTypes = params.map(p => {
      if (/^['"]/.test(p)) return "{string}";
      if (/^\d+$/.test(p)) return "{number}";
      return "{param}";
    });
    return `${fnName}(${paramTypes.join(", ")})`;
  }
  return onclick.slice(0, 50);
}

async function findAttachmentArea(page: Page, logs: string[]): Promise<any | null> {
  // 첨부파일 영역 찾기
  const areaSelectors = [
    ".file-list",
    ".attach-list",
    ".file_list",
    ".attach_list",
    ".attachFile",
    ".file-area",
    ".attach-area",
    "[class*='attach']",
    "[class*='file']",
  ];
  
  for (const selector of areaSelectors) {
    try {
      const area = await page.$(selector);
      if (area) {
        const text = await area.textContent() || "";
        if (text.length > 0) {
          log(logs, "DEBUG", `첨부파일 영역 발견: ${selector}`);
          return area;
        }
      }
    } catch {}
  }
  
  // 텍스트로 찾기: "첨부파일", "첨부", "다운로드" 등
  try {
    const attachTexts = ["첨부파일", "첨부", "다운로드", "내려받기", "Attachment", "Download"];
    for (const text of attachTexts) {
      const elements = await page.$$(`text=${text}`);
      for (const el of elements) {
        const parent = await el.evaluateHandle((e: Element) => e.closest("div, section, article, td, tr"));
        if (parent) {
          log(logs, "DEBUG", `'${text}' 텍스트로 첨부파일 영역 발견`);
          return parent;
        }
      }
    }
  } catch {}
  
  return null;
}

// ============================================================
// API 라우트
// ============================================================

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      list_url, 
      article_selector, 
      download_selector,
      sample_article_links  // DOM 분석에서 추출된 샘플 게시글 링크들
    } = body;
    
    if (!list_url) {
      return NextResponse.json({ success: false, error: "list_url is required" }, { status: 400 });
    }
    
    // DOM 분석 결과의 샘플 링크 전달
    const result = await detectDownloadUrl(list_url, sample_article_links);
    
    return NextResponse.json(result);
    
  } catch (err) {
    console.error("다운로드 URL 감지 오류:", err);
    return NextResponse.json(
      { success: false, error: String(err), logs: [] },
      { status: 500 }
    );
  }
}
