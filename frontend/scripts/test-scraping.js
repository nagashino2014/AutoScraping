const http = require('http');

const webConfig = {
  rendering: 'static_html',
  list: {
    item_selector: 'tbody tr',
    container_selector: 'table.table_case01',
    pagination: { type: 'next_button', selector: 'a.next' }
  },
  parse_rules: {
    title: 'td.al a',
    date: 'td:nth-child(5)',
    link: 'td.al a'
  },
  detail: {
    content_selector: 'article, .content, .view_content, #content',
    title_selector: 'h1, .title, .view_title'
  },
  collect_body: true,
  attachments: {
    enabled: true,
    collect_all: true,
    selector: "a[href*='.hwp'], a[href*='.pdf'], a[href*='.doc'], a[href*='.xls']"
  }
};

const data = JSON.stringify({
  list_url: 'https://mcee.go.kr/home/web/index.do?menuId=10525',
  web_config: webConfig
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/scraper/targets/boards/test-scraping',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  },
  timeout: 120000
};

console.log('🔍 mcee_board1 스크래핑 테스트 시작...\n');

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(body);
      console.log(json.logs || json.error || 'No logs');
      console.log('\n========================================');
      if (json.success) {
        console.log('✅ 테스트 성공! 이 config로 스크래핑이 가능합니다.');
      } else {
        console.log('❌ 테스트 실패. config를 확인해주세요.');
      }
    } catch (e) {
      console.log('Response:', body.substring(0, 3000));
    }
  });
});

req.on('timeout', () => {
  console.error('⏱ 요청 타임아웃 (120초)');
  req.destroy();
});

req.on('error', (e) => {
  console.error('❌ Error:', e.message);
  console.log('\n서버가 실행 중인지 확인해주세요 (npm run dev)');
});

req.write(data);
req.end();
