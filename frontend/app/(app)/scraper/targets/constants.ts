/**
 * 스크래퍼 대상 관리 - 상수 정의
 */

// 문서 유형 목록
export const DOC_TYPES = [
  { value: "보도자료", label: "보도자료", color: "blue" },
  { value: "공지", label: "공지", color: "amber" },
  { value: "고시·훈령·예규", label: "고시·훈령·예규", color: "emerald" },
  { value: "입법예고", label: "입법예고", color: "orange" },
  { value: "법령", label: "법령", color: "indigo" },
  { value: "기술문서", label: "기술문서", color: "rose" },
  { value: "정책", label: "정책", color: "teal" },
  { value: "연보·월보", label: "연보·월보", color: "cyan" },
  { value: "통계자료", label: "통계자료", color: "purple" },
  { value: "산업동향", label: "산업동향", color: "fuchsia" },
] as const;

// 기관 유형 목록
export const ORG_TYPES = [
  { value: "국가기관", label: "국가기관" },
  { value: "유관기관", label: "유관기관" },
  { value: "협회 및 학회", label: "협회 및 학회" },
] as const;

// 접근 모드 목록
export const ACCESS_MODES = [
  { value: "static_html", label: "정적 HTML", description: "일반적인 HTML 페이지" },
  { value: "dynamic_js", label: "동적 JS", description: "JavaScript로 렌더링되는 페이지" },
  { value: "api", label: "API", description: "API 엔드포인트 직접 호출" },
  { value: "login_required", label: "로그인 필요", description: "인증이 필요한 페이지" },
] as const;

// 보드 모드 목록
export const BOARD_MODES = [
  { value: "web_scraping", label: "웹 스크래핑" },
  { value: "api", label: "API" },
  { value: "hybrid", label: "하이브리드" },
] as const;

// 수집 모드 목록
export const COLLECTION_MODES = [
  { value: "web_scraping", label: "웹 스크래핑" },
  { value: "api_only", label: "API 전용" },
  { value: "hybrid", label: "하이브리드" },
] as const;

// 중복 제거 키 목록
export const DEDUP_KEYS = [
  { value: "url", label: "URL", description: "게시물 URL로 중복 체크" },
  { value: "id", label: "ID", description: "게시물 ID로 중복 체크" },
  { value: "hash", label: "해시", description: "콘텐츠 해시로 중복 체크" },
] as const;

// 수집 범위 유형 목록
export const COLLECTION_RANGE_TYPES = [
  { value: "period", label: "기간 지정", description: "특정 기간의 게시물 수집" },
  { value: "relative", label: "상대 기간", description: "최근 N일간의 게시물 수집" },
  { value: "yearly", label: "연도별", description: "특정 연도의 게시물 수집" },
] as const;

// 첨부파일 패턴 유형 목록
export const ATTACHMENT_PATTERN_TYPES = [
  { value: "auto", label: "자동 감지", description: "일반적인 패턴 자동 감지" },
  { value: "standard_href", label: "표준 href", description: "a 태그의 href 속성 사용" },
  { value: "onclick_fndownload", label: "onclick fnDownload", description: "fnDownload 함수 호출" },
  { value: "onclick_javascript", label: "onclick JavaScript", description: "JavaScript 다운로드" },
  { value: "file_area_button", label: "파일 영역 버튼", description: "별도 파일 영역의 버튼" },
] as const;

// 브라우저 유형 목록
export const BROWSER_TYPES = [
  { value: "chromium", label: "Chromium" },
  { value: "chrome", label: "Chrome" },
  { value: "msedge", label: "Microsoft Edge" },
] as const;

// 스케줄 주기 유형 목록
export const SCHEDULE_CYCLE_TYPES = [
  { value: "monthly", label: "매월" },
  { value: "weekly", label: "매주" },
  { value: "interval", label: "N일 간격" },
] as const;

// 요일 목록
export const WEEKDAYS = [
  { value: "0", label: "일요일" },
  { value: "1", label: "월요일" },
  { value: "2", label: "화요일" },
  { value: "3", label: "수요일" },
  { value: "4", label: "목요일" },
  { value: "5", label: "금요일" },
  { value: "6", label: "토요일" },
] as const;

// 시간 옵션 (0-23)
export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i}시`,
}));

// 분 옵션 (0, 15, 30, 45)
export const MINUTE_OPTIONS = [
  { value: "0", label: "0분" },
  { value: "15", label: "15분" },
  { value: "30", label: "30분" },
  { value: "45", label: "45분" },
] as const;

// 월별 일자 옵션 (1-28)
export const MONTHLY_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `${i + 1}일`,
}));

// 도메인 태그 프리셋
export const DOMAIN_TAG_PRESETS = [
  "환경",
  "대기",
  "수질",
  "폐기물",
  "토양",
  "온실가스",
  "화학물질",
  "자원순환",
  "에너지",
  "기후변화",
  "환경영향평가",
  "자연생태",
  "해양환경",
  "소음진동",
  "환경보건",
  "녹색산업",
  "환경기술",
  "환경정책",
  "환경법규",
  "국제협력",
] as const;

// API 인증 유형 목록
export const API_AUTH_TYPES = [
  { value: "none", label: "인증 없음" },
  { value: "api_key", label: "API Key" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
] as const;

// HTTP 메서드 목록
export const HTTP_METHODS = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
] as const;

// 사이트 검색 옵션 유형 목록
export const SITE_SEARCH_OPTION_TYPES = [
  { value: "select", label: "선택박스" },
  { value: "text", label: "텍스트" },
  { value: "date", label: "날짜" },
  { value: "radio", label: "라디오" },
  { value: "checkbox", label: "체크박스" },
] as const;

// 제출 유형 목록
export const SUBMIT_TYPES = [
  { value: "form", label: "폼 제출" },
  { value: "url_param", label: "URL 파라미터" },
  { value: "ajax", label: "AJAX" },
] as const;

// 페이지네이션 유형 목록
export const PAGINATION_TYPES = [
  { value: "page_number", label: "페이지 번호" },
  { value: "next_button", label: "다음 버튼" },
  { value: "infinite_scroll", label: "무한 스크롤" },
  { value: "none", label: "없음" },
] as const;
