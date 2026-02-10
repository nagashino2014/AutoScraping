/**
 * 스크래퍼 대상 관리 - 유틸리티 함수
 */

/**
 * JSON fetch wrapper
 */
export async function jsonFetch<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    // 로그인 리다이렉트(HTML) 등 JSON이 아닌 응답을 조기에 감지
    const text = await res.text().catch(() => "");
    throw new Error(text ? "non_json_response" : "invalid_response");
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = data?.error ? String(data.error) : "request_failed";
    throw new Error(msg);
  }
  return data as T;
}

/**
 * 날짜 형식 감지
 */
export function detectDateFormat(dateStr: string): string {
  if (!dateStr) return "";
  
  // 공백 제거 및 트림
  const s = dateStr.trim();
  
  // YYYY-MM-DD 또는 YYYY.MM.DD
  if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(s)) {
    if (s.includes("-")) return "YYYY-MM-DD";
    if (s.includes(".")) return "YYYY.MM.DD";
    return "YYYY/MM/DD";
  }
  
  // YYYY년 MM월 DD일
  if (/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(s)) {
    return "YYYY년 MM월 DD일";
  }
  
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    return "MM/DD/YYYY";
  }
  
  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    return "DD/MM/YYYY";
  }
  
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    return "YYYYMMDD";
  }
  
  return "";
}

/**
 * 스케줄 설정을 cron 표현식으로 변환
 */
export function scheduleConfigToCron(config: {
  scheduleMode: "period" | "cycle" | "";
  cycleType?: "monthly" | "weekly" | "interval" | "";
  monthlyDay?: string;
  weeklyDay?: string;
  intervalDays?: string;
  hour?: string;
  minute?: string;
}): string {
  if (config.scheduleMode !== "cycle") return "";
  
  const minute = config.minute || "0";
  const hour = config.hour || "9";
  
  switch (config.cycleType) {
    case "monthly":
      const day = config.monthlyDay || "1";
      return `${minute} ${hour} ${day} * *`;
    
    case "weekly":
      const weekDayMap: Record<string, string> = {
        "0": "0", // 일
        "1": "1", // 월
        "2": "2", // 화
        "3": "3", // 수
        "4": "4", // 목
        "5": "5", // 금
        "6": "6", // 토
      };
      const weekDay = weekDayMap[config.weeklyDay || "1"] || "1";
      return `${minute} ${hour} * * ${weekDay}`;
    
    case "interval":
      const interval = config.intervalDays || "1";
      return `${minute} ${hour} */${interval} * *`;
    
    default:
      return "";
  }
}

/**
 * cron 표현식을 한국어로 해석
 */
export function cronToKorean(cron: string): string {
  if (!cron) return "";
  
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  
  const hourStr = hour === "*" ? "" : `${hour}시`;
  const minuteStr = minute === "*" ? "" : `${minute}분`;
  const timeStr = hourStr || minuteStr ? `${hourStr} ${minuteStr}`.trim() : "";
  
  // 매일
  if (dayOfMonth === "*" && dayOfWeek === "*") {
    return `매일 ${timeStr}`;
  }
  
  // 매주
  if (dayOfMonth === "*" && dayOfWeek !== "*") {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
    const dayName = dayNames[parseInt(dayOfWeek)] || dayOfWeek;
    return `매주 ${dayName}요일 ${timeStr}`;
  }
  
  // 매월
  if (dayOfMonth !== "*" && !dayOfMonth.startsWith("*/")) {
    return `매월 ${dayOfMonth}일 ${timeStr}`;
  }
  
  // N일 간격
  if (dayOfMonth.startsWith("*/")) {
    const interval = dayOfMonth.replace("*/", "");
    return `${interval}일 간격 ${timeStr}`;
  }
  
  return cron;
}

/**
 * 기관 유형별 색상 클래스
 */
export function getOrgTypeColorClass(orgType?: string): {
  bg: string;
  text: string;
  border: string;
} {
  switch (orgType) {
    case "국가기관":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
      };
    case "유관기관":
      return {
        bg: "bg-green-50",
        text: "text-green-700",
        border: "border-green-200",
      };
    case "협회 및 학회":
      return {
        bg: "bg-purple-50",
        text: "text-purple-700",
        border: "border-purple-200",
      };
    default:
      return {
        bg: "bg-stone-50",
        text: "text-stone-700",
        border: "border-stone-200",
      };
  }
}

/**
 * 문서 유형별 색상 클래스
 */
export function getDocTypeColorClass(docType?: string): {
  bg: string;
  text: string;
} {
  const t = (docType ?? "").trim();
  
  switch (t) {
    case "보도자료":
      return { bg: "bg-blue-100", text: "text-blue-800" };
    case "공지":
      return { bg: "bg-amber-100", text: "text-amber-800" };
    case "고시·훈령·예규":
      return { bg: "bg-emerald-100", text: "text-emerald-800" };
    case "입법예고":
      return { bg: "bg-orange-100", text: "text-orange-800" };
    case "법령":
      return { bg: "bg-indigo-100", text: "text-indigo-800" };
    case "기술문서":
      return { bg: "bg-rose-100", text: "text-rose-800" };
    case "정책":
      return { bg: "bg-teal-100", text: "text-teal-800" };
    case "연보·월보":
      return { bg: "bg-cyan-100", text: "text-cyan-800" };
    case "통계자료":
      return { bg: "bg-purple-100", text: "text-purple-800" };
    case "산업동향":
      return { bg: "bg-fuchsia-100", text: "text-fuchsia-800" };
    default:
      return { bg: "bg-stone-100", text: "text-stone-800" };
  }
}

/**
 * 수집 모드 라벨
 */
export function getCollectionModeLabel(mode?: string): string {
  switch (mode) {
    case "web_scraping":
      return "웹 스크래핑";
    case "api_only":
      return "API 전용";
    case "hybrid":
      return "하이브리드";
    default:
      return "미설정";
  }
}

/**
 * 접근 모드 라벨
 */
export function getAccessModeLabel(mode?: string): string {
  switch (mode) {
    case "api":
      return "API";
    case "static_html":
      return "정적 HTML";
    case "dynamic_js":
      return "동적 JS";
    case "login_required":
      return "로그인 필요";
    default:
      return "미설정";
  }
}

/**
 * 바이트를 읽기 쉬운 형식으로 변환
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}
