const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ 
    headless: false,
    channel: 'msedge',
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  });
  
  const page = await context.newPage();
  
  // 1. 메인 페이지 접속 (Referer 설정)
  console.log('1. 메인 페이지 접속...');
  await page.goto('https://www.motir.go.kr/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  // 2. 상세 페이지로 이동
  const detailUrl = 'https://www.motir.go.kr/kor/article/ATCL3f49a5a8c/171444/view';
  console.log('2. 상세 페이지로 이동:', detailUrl);
  await page.goto(detailUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  
  console.log('3. 페이지 로드 완료:', await page.title());
  
  // 3. 첨부파일 영역 분석
  const attachmentInfo = await page.evaluate(() => {
    const result = {
      attachLinks: [],
      attachHtml: '',
    };
    
    // 첨부파일 관련 링크 모두 찾기
    const links = document.querySelectorAll('a[href*="/attach/"], a[href*="download"], a[href*="file"]');
    links.forEach(a => {
      result.attachLinks.push({
        href: a.getAttribute('href') || '',
        onclick: a.getAttribute('onclick') || '',
        text: a.textContent.trim().substring(0, 50),
        outerHTML: a.outerHTML.substring(0, 300),
      });
    });
    
    // 첨부파일 영역 HTML
    const attachArea = document.querySelector('.file-list, .attach-list, [class*="file"], [class*="attach"], .board-view');
    if (attachArea) {
      result.attachHtml = attachArea.outerHTML.substring(0, 3000);
    }
    
    return result;
  });
  
  console.log('\n=== 첨부파일 링크 ===');
  attachmentInfo.attachLinks.forEach((link, i) => {
    console.log(`${i+1}. href="${link.href}"`);
    console.log(`   onclick="${link.onclick}"`);
    console.log(`   text="${link.text}"`);
    console.log(`   HTML: ${link.outerHTML}\n`);
  });
  
  // 4. 네트워크 캡처 설정 후 다운로드 버튼 클릭
  console.log('\n=== 다운로드 버튼 클릭 테스트 ===');
  
  const downloadUrls = [];
  
  // 네트워크 요청 모니터링
  page.on('request', req => {
    const url = req.url();
    if (url.includes('/attach/') || url.includes('download')) {
      console.log('[REQUEST]', req.method(), url);
      downloadUrls.push({ type: 'request', url, method: req.method() });
    }
  });
  
  page.on('response', res => {
    const url = res.url();
    const headers = res.headers();
    if (url.includes('/attach/') || headers['content-disposition']) {
      console.log('[RESPONSE]', res.status(), url);
      if (headers['content-disposition']) {
        console.log('  Content-Disposition:', headers['content-disposition']);
      }
      downloadUrls.push({ type: 'response', url, status: res.status() });
    }
  });
  
  // 첫 번째 첨부파일 링크 클릭
  if (attachmentInfo.attachLinks.length > 0) {
    const firstLink = attachmentInfo.attachLinks[0];
    console.log(`\n클릭 대상: ${firstLink.href}`);
    
    try {
      const linkEl = page.locator(`a[href="${firstLink.href}"]`).first();
      
      // 다운로드 이벤트 대기
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
        linkEl.click({ timeout: 5000 }).catch(() => null),
      ]);
      
      if (download) {
        console.log('\n✅ 다운로드 이벤트 캡처!');
        console.log('   URL:', download.url());
        console.log('   파일명:', download.suggestedFilename());
        await download.cancel();
      } else {
        console.log('\n다운로드 이벤트 없음 - 네트워크 로그 확인');
      }
    } catch (err) {
      console.log('클릭 오류:', err.message);
    }
  }
  
  await page.waitForTimeout(2000);
  
  console.log('\n=== 캡처된 다운로드 URL ===');
  downloadUrls.forEach((item, i) => {
    console.log(`${i+1}. [${item.type}] ${item.url}`);
  });
  
  await browser.close();
  console.log('\nDone!');
})();
