/**
 * API 즉시 실행 - SSE 스트림 (범용화 버전)
 * 
 * 다양한 API 서비스를 지원하는 범용 API 스크래핑 엔진
 * - JSON/XML 응답 파싱
 * - GET/POST 메서드 지원
 * - 다양한 인증 방식 (API Key, Bearer, OAuth2)
 * - 커스텀 응답 데이터 경로
 * - Rate Limit 설정
 */

import { NextRequest, NextResponse } from "next/server";
import { readScraperTargets, type Board } from "@/lib/scraper/targets-store";
import { exportApiData } from "@/lib/scraper/api-export";
import { parseStringPromise } from "xml2js";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================
// 상수 정의
// ============================================================

const API_SAVE_DIR = "C:\\CodingProject\\Web Scraper Final\\frontend\\save\\Test\\API";

// ============================================================
// 환경변수에서 시크릿 가져오기
// ============================================================

function getEnvSecret(ref?: string): string | null {
  if (!ref) return null;
  if (!ref.startsWith("ENV:")) return null;
  const key = ref.slice("ENV:".length);
  if (!key) return null;
  return process.env[key] ?? null;
}

// ============================================================
// 유틸리티 함수
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 타입 정의 (범용화)
// ============================================================

interface DateFilter {
  field: string;
  start_date?: string;
  end_date?: string;
  format?: string;
  relative_days?: number;
}

interface SearchFilter {
  field: string;
  keywords: string[];
  match_type: "contains" | "exact" | "regex" | "any";
}

interface EndpointConfig {
  name: string;
  path: string;
  method: string;
  params?: Record<string, string>;
  response_fields?: string[];
  // POST 요청 본문 설정
  body_type?: "json" | "form" | "none";
  body_template?: Record<string, any>;
  // 2단계 호출 시 ID 매핑
  id_field?: string;
  id_param?: string;
}

// 인증 설정 (범용화)
interface ApiAuth {
  type: "param" | "header" | "bearer" | "basic" | "oauth2";
  in?: "query" | "header";
  param_name?: string;
  name?: string;
  secret_ref?: string;
  // Bearer 토큰
  bearer_prefix?: string; // 기본값: "Bearer"
  // Basic 인증
  username_ref?: string;
  password_ref?: string;
  // OAuth2 설정
  token_url?: string;
  client_id_ref?: string;
  client_secret_ref?: string;
  scope?: string;
}

interface ApiConfig {
  primary_endpoint: EndpointConfig;
  secondary_endpoints?: EndpointConfig[];
  params: Record<string, string>;
  pagination?: {
    type: string;
    param_name: string;
    page_size: number;
    max_pages: number;
  };
  response_fields?: string[];
  search_filters?: SearchFilter[];
  date_filters?: DateFilter[];
  // 응답 데이터 경로 설정 (범용화)
  response_data_path?: string;  // 예: "data.items", "result.list", "LawSearch.law"
  // 2단계 호출 설정 (새 구조: field_mappings 지원)
  two_phase?: {
    enabled: boolean;
    // 새 구조: 다중 필드 매핑 (보조 엔드포인트 응답 필드 → 주 엔드포인트 요청 파라미터)
    field_mappings?: { source_field: string; target_param: string }[];
    // 주 엔드포인트 검색필터 → 보조 엔드포인트 필드 매핑 (목록 결과 필터링용)
    filter_mappings?: { 
      primary_filter_idx: number;  // 주 엔드포인트의 검색필터 인덱스
      secondary_field: string;     // 필터를 적용할 보조 엔드포인트의 필드명
    }[];
    // 검색 필터 키워드를 보조 엔드포인트 query로 사용 (각 키워드마다 순차 검색)
    use_filter_keywords?: boolean;
    query_param_name?: string;     // query 파라미터명 (기본값: "query")
    // 레거시 호환 (단일 필드 매핑)
    list_id_field?: string;
    detail_id_param?: string;
    // 호출 제한
    max_list_items?: number;    // 목록에서 최대 가져올 항목 수 (새 필드)
    max_detail_items?: number;  // 본문 조회 최대 건수 (새 필드)
    max_details?: number;       // 레거시 호환
  };
  // Rate Limit 설정 (범용화)
  rate_limit?: {
    requests_per_second?: number;
    delay_between_requests?: number; // ms
    delay_between_pages?: number;    // ms
  };
  // 항목 제목 필드 (로그 표시용)
  title_field?: string;  // 예: "title", "name", "법령명_한글"
}

interface ApiProfile {
  base_url: string;
  auth?: ApiAuth;
  default_params?: Record<string, string>;
  endpoints?: any[];
}

// ============================================================
// 날짜 필터 적용
// ============================================================

function applyDateFilters(
  params: Record<string, string>,
  dateFilters?: DateFilter[]
): Record<string, string> {
  if (!dateFilters || dateFilters.length === 0) return params;

  const result = { ...params };
  const today = new Date();

  for (const df of dateFilters) {
    if (!df.field) continue;

    let startDate = df.start_date;
    let endDate = df.end_date;

    if (df.relative_days && df.relative_days > 0) {
      const pastDate = new Date(today);
      pastDate.setDate(pastDate.getDate() - df.relative_days);
      startDate = formatDateForApi(pastDate, df.format);
      endDate = formatDateForApi(today, df.format);
    }

    if (df.field.toLowerCase().includes("start") || df.field.toLowerCase().includes("from")) {
      if (startDate) result[df.field] = startDate;
    } else if (df.field.toLowerCase().includes("end") || df.field.toLowerCase().includes("to")) {
      if (endDate) result[df.field] = endDate;
    } else {
      if (startDate) result[df.field] = startDate;
    }
  }

  return result;
}

function formatDateForApi(date: Date, format?: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  switch (format) {
    case "YYYYMMDD":
      return `${y}${m}${d}`;
    case "YYYY/MM/DD":
      return `${y}/${m}/${d}`;
    case "YYYY.MM.DD":
      return `${y}.${m}.${d}`;
    case "YYYY-MM-DD":
    default:
      return `${y}-${m}-${d}`;
  }
}

// ============================================================
// 중첩 객체에서 값 가져오기 (범용)
// ============================================================

function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  if (obj[path] !== undefined) return obj[path];
  
  // 배열 인덱스 지원: "items[0].name" 또는 "data.results[0]"
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeKey(key: string): string {
  return String(key ?? "")
    .replace(/[\s_]+/g, "")
    .toLowerCase();
}

function buildDeepKeyIndex(root: any): Map<string, any[]> {
  const index = new Map<string, any[]>();
  const seen = new WeakSet<object>();

  const push = (k: string, v: any) => {
    const nk = normalizeKey(k);
    if (!nk) return;
    const arr = index.get(nk) ?? [];
    arr.push(v);
    index.set(nk, arr);
  };

  const walk = (node: any) => {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      push(k, v);
      walk(v);
    }
  };

  walk(root);
  return index;
}

/**
 * 국가법령정보처럼 "서비스명" 루트가 아니라, 최상위 루트가 곧 문서(예: <법령>)인 응답을 detail 객체로 추출
 */
function extractDetailRootObject(parsed: any): any | null {
  if (!parsed || typeof parsed !== "object") return null;

  // 대표적인 루트 태그(국가법령정보 OPEN API)
  const candidates = ["법령", "행정규칙", "자치법규", "판례", "헌재결정례", "결정례", "영문법령"];
  for (const key of candidates) {
    if (parsed[key] && typeof parsed[key] === "object") return parsed[key];
  }

  // 최상위 키가 1개뿐이면 그 값을 detail 루트로 간주(범용)
  const keys = Object.keys(parsed);
  if (keys.length === 1) {
    const only = parsed[keys[0]];
    if (only && typeof only === "object") return only;
  }

  return null;
}

// ============================================================
// 검색 필터 적용 (응답 데이터 필터링)
// ============================================================

function applySearchFilters(data: any[], searchFilters?: SearchFilter[]): any[] {
  if (!searchFilters || searchFilters.length === 0) return data;
  
  return data.filter((item) => {
    for (const filter of searchFilters) {
      const value = getNestedValue(item, filter.field);
      
      if (value === undefined || value === null) {
        continue;
      }

      const strValue = String(value);
      let matches = false;
      
      switch (filter.match_type) {
        case "exact":
          matches = filter.keywords.some((keyword) => strValue === keyword);
          break;
          
        case "regex":
          matches = filter.keywords.some((keyword) => {
            try {
              return new RegExp(keyword, "i").test(strValue);
            } catch {
              return false;
            }
          });
          break;
          
        case "any":
        case "contains":
        default:
          matches = filter.keywords.some((keyword) =>
            strValue.toLowerCase().includes(keyword.toLowerCase())
          );
          break;
      }

      if (!matches) {
        return false;
      }
    }
    return true;
  });
}

// ============================================================
// 응답 필드 필터링
// ============================================================

function filterResponseFields(data: any[], responseFields?: string[]): any[] {
  if (!responseFields || responseFields.length === 0) {
    return data;
  }
  
  return data.map((item) => {
    const filtered: Record<string, any> = {};
    const deepIndex = buildDeepKeyIndex(item);
    
    for (const field of responseFields) {
      if (item[field] !== undefined) {
        filtered[field] = item[field];
      } else {
        const value = getNestedValue(item, field);
        if (value !== undefined) {
          filtered[field] = value;
        } else {
          // 키 이름 차이/중첩 구조 대응: "법령명_한글" vs "법령명한글" 같은 케이스를 포함
          const values = deepIndex.get(normalizeKey(field));
          if (values && values.length > 0) {
            filtered[field] = values.length === 1 ? values[0] : values;
          }
        }
      }
    }
    
    return filtered;
  });
}

// ============================================================
// XML 파싱 (범용)
// ============================================================

async function parseXmlResponse(xmlText: string): Promise<any> {
  try {
    const result = await parseStringPromise(xmlText, {
      explicitArray: false,      // 단일 요소는 배열로 만들지 않음
      ignoreAttrs: false,        // 속성 유지
      mergeAttrs: true,          // 속성을 요소와 병합
      trim: true,                // 공백 제거
      normalize: true,           // 공백 정규화
      normalizeTags: false,      // 태그명 소문자 변환 안함
    });
    return result;
  } catch (error) {
    console.error("XML 파싱 오류:", error);
    return { raw_xml: xmlText, parse_error: String(error) };
  }
}

// ============================================================
// API 응답에서 데이터 추출 (범용화)
// ============================================================

function extractDataFromResponse(response: any, dataPath?: string): any[] {
  if (!response) return [];

  // 1. 커스텀 데이터 경로가 지정된 경우 우선 사용
  if (dataPath) {
    const data = getNestedValue(response, dataPath);
    if (data !== undefined) {
      return Array.isArray(data) ? data : [data];
    }
  }

  // 2. 배열인 경우 그대로 반환
  if (Array.isArray(response)) {
    return response;
  }

  // 3. 객체인 경우 공통 데이터 경로 자동 탐색
  if (typeof response === "object") {
    // 일반적인 API 응답 구조 탐색
    const commonPaths = [
      // 영문 키
      "data", "items", "results", "records", "list", "rows", "content",
      "response", "body", "documents", "entries", "objects",
      // REST API 표준
      "data.items", "data.list", "data.results", "data.records",
      "response.body", "response.data", "response.items",
      "result.data", "result.items", "result.list",
      // 공공데이터 포털 표준
      "response.body.items.item",
      "response.body.items",
      // 국가법령정보 API
      "LawSearch.law", "AdmRulSearch.admrul", "OrdinSearch.ordin",
      "PrecSearch.prec", "DecsSearch.decis",
      "LawService.law", "AdmRulService.admrul", "OrdinService.ordin",
      // 페이지네이션 응답
      "page.content", "page.items",
      "_embedded.items", "_embedded.data",
    ];

    for (const path of commonPaths) {
      const data = getNestedValue(response, path);
      if (data !== undefined && data !== null) {
        if (Array.isArray(data)) {
          return data;
        }
        if (typeof data === "object" && Object.keys(data).length > 0) {
          // 객체지만 데이터를 포함하는 경우
          const innerArray = Object.values(data).find(v => Array.isArray(v));
          if (innerArray) {
            return innerArray as any[];
          }
          return [data];
        }
      }
    }

    // 4. 최상위 객체의 첫 번째 배열 속성 탐색
    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key])) {
        return response[key];
      }
    }

    // 5. 중첩 객체에서 배열 탐색 (최대 2단계)
    for (const key of Object.keys(response)) {
      if (typeof response[key] === "object" && response[key] !== null) {
        for (const subKey of Object.keys(response[key])) {
          if (Array.isArray(response[key][subKey])) {
            return response[key][subKey];
          }
        }
      }
    }

    // 6. 객체 자체를 단일 항목으로 반환
    return [response];
  }

  return [];
}

// ============================================================
// 인증 처리 (범용화)
// ============================================================

async function applyAuthentication(
  url: URL,
  headers: Record<string, string>,
  auth: ApiAuth,
  logs?: string[]
): Promise<void> {
  const authType = auth.type || "param";

  switch (authType) {
    case "param":
    case "header": {
      // API Key 방식
      const authIn = (auth.in || (authType === "header" ? "header" : "query")).toLowerCase();
      const authName = auth.param_name || auth.name || "";
      const secret = getEnvSecret(auth.secret_ref);

      if (secret && authName) {
        if (authIn === "header") {
          headers[authName] = secret;
          logs?.push(`[AUTH] 헤더 인증: ${authName}`);
        } else {
          url.searchParams.set(authName, secret);
          logs?.push(`[AUTH] 쿼리 파라미터 인증: ${authName}`);
        }
      } else if (!secret && auth.secret_ref) {
        logs?.push(`[WARN] 인증 시크릿을 찾을 수 없음: ${auth.secret_ref}`);
      }
      break;
    }

    case "bearer": {
      // Bearer Token 방식
      const token = getEnvSecret(auth.secret_ref);
      const prefix = auth.bearer_prefix || "Bearer";
      
      if (token) {
        headers["Authorization"] = `${prefix} ${token}`;
        logs?.push(`[AUTH] Bearer 토큰 인증 적용`);
      } else if (auth.secret_ref) {
        logs?.push(`[WARN] Bearer 토큰을 찾을 수 없음: ${auth.secret_ref}`);
      }
      break;
    }

    case "basic": {
      // Basic Auth 방식
      const username = getEnvSecret(auth.username_ref);
      const password = getEnvSecret(auth.password_ref);
      
      if (username && password) {
        const credentials = Buffer.from(`${username}:${password}`).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
        logs?.push(`[AUTH] Basic 인증 적용`);
      } else {
        logs?.push(`[WARN] Basic 인증 정보를 찾을 수 없음`);
      }
      break;
    }

    case "oauth2": {
      // OAuth2 Client Credentials 방식
      if (!auth.token_url) {
        logs?.push(`[WARN] OAuth2 token_url이 설정되지 않음`);
        break;
      }

      const clientId = getEnvSecret(auth.client_id_ref);
      const clientSecret = getEnvSecret(auth.client_secret_ref);

      if (!clientId || !clientSecret) {
        logs?.push(`[WARN] OAuth2 클라이언트 정보를 찾을 수 없음`);
        break;
      }

      try {
        logs?.push(`[AUTH] OAuth2 토큰 요청 중...`);
        
        const tokenResponse = await fetch(auth.token_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
            ...(auth.scope ? { scope: auth.scope } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!tokenResponse.ok) {
          logs?.push(`[ERROR] OAuth2 토큰 요청 실패: ${tokenResponse.status}`);
          break;
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (accessToken) {
          const tokenType = tokenData.token_type || "Bearer";
          headers["Authorization"] = `${tokenType} ${accessToken}`;
          logs?.push(`[AUTH] OAuth2 토큰 획득 성공`);
        } else {
          logs?.push(`[WARN] OAuth2 응답에서 access_token을 찾을 수 없음`);
        }
      } catch (error) {
        logs?.push(`[ERROR] OAuth2 토큰 요청 오류: ${error}`);
      }
      break;
    }

    default:
      logs?.push(`[WARN] 알 수 없는 인증 타입: ${authType}`);
  }
}

// ============================================================
// 단일 엔드포인트 API 호출 실행 (범용화)
// ============================================================

async function executeSingleApiCall(
  apiProfile: ApiProfile,
  endpoint: EndpointConfig,
  params: Record<string, string>,
  bodyData?: Record<string, any>,
  logs?: string[]
): Promise<{ data: any; error?: string; url?: string; rawXml?: string; hierarchicalData?: any }> {
  const baseUrl = apiProfile.base_url;
  if (!baseUrl) {
    return { data: null, error: "base_url이 설정되지 않았습니다." };
  }

  if (!endpoint.path) {
    return { data: null, error: "endpoint path가 설정되지 않았습니다." };
  }

  try {
    const url = new URL(endpoint.path, baseUrl);
    const method = (endpoint.method || "GET").toUpperCase();

    // 헤더 설정
    const headers: Record<string, string> = {
      "User-Agent": "EcoMonitorBot/1.0 (universal_api_scraper)",
      Accept: "application/json, application/xml, text/xml, text/html, */*",
    };

    // GET 요청의 경우 파라미터를 URL에 추가
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }

    // 인증 처리
    if (apiProfile.auth) {
      await applyAuthentication(url, headers, apiProfile.auth, logs);
    }

    // 요청 옵션 구성
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(60000),
    };

    // POST 요청 본문 설정
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      const bodyType = endpoint.body_type || "json";
      const finalBody = bodyData || endpoint.body_template || params;

      if (bodyType === "json") {
        headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(finalBody);
        logs?.push(`[REQUEST] Body (JSON): ${JSON.stringify(finalBody).slice(0, 200)}...`);
      } else if (bodyType === "form") {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        fetchOptions.body = new URLSearchParams(finalBody as Record<string, string>).toString();
        logs?.push(`[REQUEST] Body (Form): ${fetchOptions.body.slice(0, 200)}...`);
      }
    }

    logs?.push(`[REQUEST] ${method} ${url.toString()}`);

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logs?.push(`[ERROR] HTTP ${response.status}: ${response.statusText}`);
      if (errorText) logs?.push(`[ERROR] Response: ${errorText.slice(0, 500)}`);
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}`, url: url.toString() };
    }

    const contentType = response.headers.get("content-type") || "";
    logs?.push(`[RESPONSE] Content-Type: ${contentType}`);

    let data;
    const responseText = await response.text();

    // JSON 응답 처리
    if (contentType.includes("application/json") || contentType.includes("text/json")) {
      try {
        data = JSON.parse(responseText);
        logs?.push(`[RESPONSE] JSON 파싱 성공`);
      } catch {
        data = { raw_text: responseText, content_type: contentType };
        logs?.push(`[WARN] JSON 파싱 실패, raw_text로 저장`);
      }
    }
    // XML 응답 처리 (자동 파싱)
    else if (contentType.includes("xml") || responseText.trim().startsWith("<?xml") || responseText.trim().startsWith("<")) {
      data = await parseXmlResponse(responseText);
      logs?.push(`[RESPONSE] XML 파싱 완료`);
      // 원본 XML과 계층 구조 데이터 함께 반환
      return { data, url: url.toString(), rawXml: responseText, hierarchicalData: data };
    }
    // 기타 응답 처리
    else {
      try {
        data = JSON.parse(responseText);
        logs?.push(`[RESPONSE] 텍스트를 JSON으로 파싱 성공`);
      } catch {
        data = { raw_text: responseText, content_type: contentType };
        logs?.push(`[RESPONSE] raw_text로 저장`);
      }
    }

    return { data, url: url.toString() };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logs?.push(`[ERROR] ${errorMsg}`);
    return { data: null, error: errorMsg };
  }
}

// ============================================================
// 목록 조회 API 호출 (primary_endpoint)
// ============================================================

async function executeListApiCall(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  pageParams?: Record<string, string>,
  logs?: string[]
): Promise<{ data: any; error?: string; url?: string }> {
  const endpoint = apiConfig.primary_endpoint;
  
  // 파라미터 구성
  let params: Record<string, string> = {};
  
  // 1. api_profile의 default_params 먼저 적용
  const defaultParams = apiProfile.default_params ?? {};
  for (const [k, v] of Object.entries(defaultParams)) {
    if (v !== undefined && v !== null && v !== "") {
      params[k] = String(v);
    }
  }
  
  // 2. 사용자 설정 파라미터 적용 (빈 값 제외)
  for (const [k, v] of Object.entries(apiConfig.params || {})) {
    if (v !== undefined && v !== null && v !== "") {
      params[k] = String(v);
    }
  }
  
  // 3. 날짜 필터 적용
  params = applyDateFilters(params, apiConfig.date_filters);
  
  // 4. 페이지네이션 파라미터 적용
  if (pageParams) {
    params = { ...params, ...pageParams };
  }
  
  return executeSingleApiCall(apiProfile, endpoint, params, undefined, logs);
}

// ============================================================
// 본문 조회 API 호출 (secondary_endpoint)
// ============================================================

async function executeDetailApiCall(
  apiProfile: ApiProfile,
  secondaryEndpoint: EndpointConfig,
  idValue: string,
  idParamName: string,
  baseParams: Record<string, string>,
  logs?: string[]
): Promise<{ data: any; error?: string; url?: string }> {
  // 파라미터 구성: 기본 파라미터 + ID 파라미터
  const params: Record<string, string> = { ...baseParams };
  params[idParamName] = idValue;
  
  // secondary_endpoint 자체 파라미터 적용
  if (secondaryEndpoint.params) {
    for (const [k, v] of Object.entries(secondaryEndpoint.params)) {
      if (v !== undefined && v !== null && v !== "") {
        params[k] = String(v);
      }
    }
  }
  
  return executeSingleApiCall(apiProfile, secondaryEndpoint, params, undefined, logs);
}

// ============================================================
// 본문 조회 API 호출 (다중 파라미터 매핑 버전)
// ============================================================

async function executeDetailApiCallWithParams(
  apiProfile: ApiProfile,
  secondaryEndpoint: EndpointConfig,
  mappedParams: Record<string, string>,
  logs?: string[]
): Promise<{ data: any; error?: string; url?: string; rawXml?: string; hierarchicalData?: any }> {
  // 이미 매핑된 파라미터를 그대로 사용
  const params: Record<string, string> = { ...mappedParams };
  
  // secondary_endpoint 자체 파라미터 적용 (이미 mappedParams에 있으면 덮어쓰지 않음)
  if (secondaryEndpoint.params) {
    for (const [k, v] of Object.entries(secondaryEndpoint.params)) {
      if (v !== undefined && v !== null && v !== "" && !(k in params)) {
        params[k] = String(v);
      }
    }
  }
  
  return executeSingleApiCall(apiProfile, secondaryEndpoint, params, undefined, logs);
}

// ============================================================
// 목록 응답에서 ID 값 추출
// ============================================================

function extractIdFromListItem(item: any, idField: string): string | null {
  if (!item || !idField) return null;
  
  const value = getNestedValue(item, idField);
  return value !== undefined && value !== null ? String(value) : null;
}

// ============================================================
// 항목 제목 추출 (로그 표시용)
// ============================================================

function extractItemTitle(item: any, titleField?: string): string {
  if (titleField) {
    const title = getNestedValue(item, titleField);
    if (title) return String(title);
  }
  
  // 공통 제목 필드 탐색
  const commonTitleFields = [
    "title", "name", "label", "subject", "headline",
    "제목", "이름", "명칭", "법령명", "법령명_한글",
  ];
  
  for (const field of commonTitleFields) {
    if (item[field]) return String(item[field]);
  }
  
  return "제목 없음";
}

// ============================================================
// GET 핸들러 (SSE 스트림)
// ============================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const boardId = searchParams.get("board_id") || searchParams.get("boardId");

  if (!boardId) {
    return new NextResponse("board_id is required", { status: 400 });
  }

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const logs: string[] = [];
      let allData: any[] = [];

      // SSE 이벤트 전송 헬퍼
      const sendEvent = (type: string, data: any) => {
        const eventData = { type, ...data };
        const eventStr = `data: ${JSON.stringify(eventData)}\n\n`;
        controller.enqueue(encoder.encode(eventStr));
      };

      const sendProgress = (phase: string, message: string, progress: number) => {
        logs.push(`[${phase}] ${message}`);
        sendEvent("progress", { phase, message, progress });
      };

      const sendLog = (message: string) => {
        logs.push(message);
        sendEvent("log", { message });
      };

      try {
        sendProgress("init", "API 즉시 실행 준비 중...", 0);

        // 보드 설정 로드
        const targetsData = readScraperTargets();
        const board = targetsData.boards.find((b) => b.board_id === boardId);

        if (!board) {
          sendEvent("error", { message: "보드를 찾을 수 없습니다." });
          controller.close();
          return;
        }

        sendProgress("init", `📋 보드: ${board.board_name}`, 5);

        // API 설정 확인
        const apiConfig = board.api_config as ApiConfig | undefined;
        if (!apiConfig || !apiConfig.primary_endpoint) {
          sendEvent("error", { message: "API 설정(api_config)이 없습니다." });
          controller.close();
          return;
        }

        // 기관 정보
        const org = targetsData.orgs.find((o) => o.org_id === board.org_id);
        if (!org) {
          sendEvent("error", { message: "기관 정보를 찾을 수 없습니다." });
          controller.close();
          return;
        }

        const apiProfile = (org.api_profile || {}) as unknown as ApiProfile;
        if (!apiProfile.base_url && org.base_url) {
          apiProfile.base_url = org.base_url;
        }

        sendProgress("init", `🔗 기관: ${org.org_name}`, 10);
        sendProgress("init", `🌐 Base URL: ${apiProfile.base_url}`, 12);

        // 설정 정보 로깅
        sendLog("");
        sendLog("── 📋 API 설정 정보 ──");
        sendLog(`엔드포인트: ${apiConfig.primary_endpoint.name || apiConfig.primary_endpoint.path}`);
        sendLog(`경로: ${apiConfig.primary_endpoint.path}`);
        sendLog(`메서드: ${apiConfig.primary_endpoint.method || "GET"}`);

        // 인증 방식 로깅
        if (apiProfile.auth) {
          sendLog(`인증 방식: ${apiProfile.auth.type || "param"}`);
        }

        // 요청 파라미터 로깅
        sendLog("요청 파라미터:");
        for (const [key, value] of Object.entries(apiConfig.params || {})) {
          if (value) sendLog(`  - ${key}: ${value}`);
        }

        // 응답 데이터 경로 로깅
        if (apiConfig.response_data_path) {
          sendLog(`응답 데이터 경로: ${apiConfig.response_data_path}`);
        }

        // 페이지네이션 설정 로깅
        if (apiConfig.pagination) {
          sendLog(`페이지네이션: ${apiConfig.pagination.type} 방식, 최대 ${apiConfig.pagination.max_pages}페이지`);
        }

        // 응답 필드 설정 로깅
        if (apiConfig.response_fields && apiConfig.response_fields.length > 0) {
          sendLog(`선택된 응답 필드 (${apiConfig.response_fields.length}개)`);
        }

        // 검색 필터 설정 로깅
        if (apiConfig.search_filters && apiConfig.search_filters.length > 0) {
          sendLog(`검색 필터 (${apiConfig.search_filters.length}개)`);
        }

        // Rate Limit 설정
        const rateLimit = apiConfig.rate_limit || {};
        const delayBetweenRequests = rateLimit.delay_between_requests ?? 300;
        const delayBetweenPages = rateLimit.delay_between_pages ?? 500;

        // 페이지네이션 설정
        const pagination = apiConfig.pagination;
        const maxPages = pagination?.max_pages || 1;
        const pageSize = pagination?.page_size || 100;
        const pageParam = pagination?.param_name || "page";

        // 2단계 호출 설정 확인 (새 구조 field_mappings 지원 + 레거시 호환)
        const twoPhase = apiConfig.two_phase;
        const secondaryEndpoint = apiConfig.secondary_endpoints?.[0];
        
        // field_mappings가 있거나 레거시 필드가 있으면 2단계 모드
        const fieldMappings = twoPhase?.field_mappings && twoPhase.field_mappings.length > 0
          ? twoPhase.field_mappings
          : twoPhase?.list_id_field && twoPhase?.detail_id_param
            ? [{ source_field: twoPhase.list_id_field, target_param: twoPhase.detail_id_param }]
            : [];
        
        const isTwoPhaseMode = twoPhase?.enabled && secondaryEndpoint && fieldMappings.length > 0;
        
        // 호출 제한 (새 구조 + 레거시 호환)
        const maxListItems = twoPhase?.max_list_items ?? 100;
        const maxDetailItems = twoPhase?.max_detail_items ?? twoPhase?.max_details ?? 10;
        
        if (isTwoPhaseMode) {
          sendLog("");
          sendLog("── 🔄 2단계 호출 모드 ──");
          sendLog(`1단계: 목록 조회 (보조) → ${secondaryEndpoint.path}`);
          sendLog(`2단계: 본문 조회 (주) → ${apiConfig.primary_endpoint.path}`);
          sendLog(`필드 매핑 (${fieldMappings.length}개):`);
          for (const mapping of fieldMappings) {
            sendLog(`  - 보조 응답 [${mapping.source_field}] → 주 파라미터 [${mapping.target_param}]`);
          }
          sendLog(`최대 목록: ${maxListItems}건, 최대 본문: ${maxDetailItems}건`);
        }

        sendProgress("api_collect", "API 데이터 수집 시작...", 15);

        // 원본 XML 응답과 계층 구조 데이터 수집 (법령 서식용)
        const rawXmlResponses: string[] = [];
        const hierarchicalDataList: any[] = [];

        // ============================================================
        // 1단계: 목록 조회 API 호출
        // 2단계 모드: 보조 엔드포인트(목록)로 호출
        // 일반 모드: 주 엔드포인트로 호출
        // ============================================================
        let listItems: any[] = [];
        
        // 2단계 모드에서 목록 조회할 엔드포인트 결정
        const listEndpoint = isTwoPhaseMode ? secondaryEndpoint : apiConfig.primary_endpoint;
        const listParams = isTwoPhaseMode 
          ? { ...apiConfig.params, ...(secondaryEndpoint.params || {}) }
          : apiConfig.params;
        
        // 검색 필터 키워드를 query로 사용하는 모드 확인
        const useFilterKeywords = twoPhase?.use_filter_keywords ?? false;
        const queryParamName = twoPhase?.query_param_name ?? "query";
        const filterMappingsForQuery = twoPhase?.filter_mappings ?? [];
        
        // 검색할 키워드 목록 결정
        let searchKeywords: string[] = [];
        if (isTwoPhaseMode && useFilterKeywords && filterMappingsForQuery.length > 0 && apiConfig.search_filters) {
          // filter_mappings에서 지정된 검색 필터의 키워드들을 모두 수집
          for (const fm of filterMappingsForQuery) {
            const filter = apiConfig.search_filters[fm.primary_filter_idx];
            if (filter && filter.keywords && filter.keywords.length > 0) {
              searchKeywords.push(...filter.keywords);
            }
          }
          // 중복 제거
          searchKeywords = [...new Set(searchKeywords)];
        }
        
        // 키워드별 순차 검색 모드
        if (searchKeywords.length > 0) {
          sendLog("");
          sendLog(`── 🔍 키워드별 순차 검색 모드 (${searchKeywords.length}개 키워드) ──`);
          for (const kw of searchKeywords) {
            sendLog(`  - "${kw}"`);
          }
          
          const seenIds = new Set<string>(); // 중복 제거용
          const idField = fieldMappings[0]?.source_field || "법령ID"; // ID 필드명
          
          for (let kwIdx = 0; kwIdx < searchKeywords.length; kwIdx++) {
            const keyword = searchKeywords[kwIdx];
            const progressPercent = 15 + Math.floor(((kwIdx + 1) / searchKeywords.length) * 15);
            sendProgress("api_collect", `키워드 검색 ${kwIdx + 1}/${searchKeywords.length}: "${keyword.slice(0, 20)}..."`, progressPercent);
            
            // 키워드로 검색 (페이지네이션은 첫 페이지만)
            const keywordParams: Record<string, string> = { ...listParams };
            keywordParams[queryParamName] = keyword;
            keywordParams[pageParam] = "1";
            
            const callLogs: string[] = [];
            const listApiConfig = { 
              ...apiConfig, 
              primary_endpoint: listEndpoint, 
              params: keywordParams 
            };
            const result = await executeListApiCall(apiProfile, listApiConfig, {}, callLogs);
            
            for (const log of callLogs) {
              sendLog(log);
            }
            
            if (result.error) {
              sendLog(`[WARN] 키워드 "${keyword}" 검색 실패: ${result.error}`);
              continue;
            }
            
            const items = extractDataFromResponse(result.data, apiConfig.response_data_path);
            sendLog(`키워드 "${keyword.slice(0, 20)}..." 검색 결과: ${items.length}건`);
            
            // 중복 제거하면서 추가
            for (const item of items) {
              const id = getNestedValue(item, idField);
              const idStr = id ? String(id) : JSON.stringify(item);
              if (!seenIds.has(idStr)) {
                seenIds.add(idStr);
                listItems.push(item);
              }
            }
            
            // Rate limiting
            if (kwIdx < searchKeywords.length - 1) {
              await delay(delayBetweenRequests);
            }
          }
          
          sendLog(`키워드 검색 완료: 총 ${listItems.length}건 (중복 제거됨)`);
          
        } else {
          // 기존 방식: 페이지네이션으로 목록 조회
          for (let page = 1; page <= maxPages; page++) {
            const progressPercent = 15 + Math.floor((page / maxPages) * 20);
            sendProgress("api_collect", `목록 조회 페이지 ${page}/${maxPages} 처리 중...`, progressPercent);

            // 페이지네이션 파라미터 구성 (범용화)
            let pageParams: Record<string, string> = {};
            if (pagination && pagination.type !== "none") {
              switch (pagination.type) {
                case "page":
                  pageParams[pageParam] = String(page);
                  break;
                case "offset":
                  pageParams[pageParam] = String((page - 1) * pageSize);
                  break;
                case "cursor":
                  // cursor 방식은 이전 응답에서 next_cursor를 가져와야 함
                  // 첫 페이지는 cursor 없이 호출
                  break;
                default:
                  // 기본: page 파라미터와 display/limit 파라미터
                  pageParams[pageParam] = String(page);
                  if (!listParams?.display && !listParams?.limit && !listParams?.size) {
                    pageParams["display"] = String(pageSize);
                  }
              }
            }

            const callLogs: string[] = [];
            // 2단계 모드: 보조 엔드포인트로 목록 조회
            const listApiConfig = { 
              ...apiConfig, 
              primary_endpoint: listEndpoint, 
              params: listParams 
            };
            const result = await executeListApiCall(apiProfile, listApiConfig, pageParams, callLogs);
            
            for (const log of callLogs) {
              sendLog(log);
            }

            if (result.error) {
              sendLog(`[ERROR] ${result.error}`);
              sendEvent("error", { message: result.error });
              controller.close();
              return;
            }

            // 데이터 추출 (커스텀 경로 또는 자동 탐색)
            const items = extractDataFromResponse(result.data, apiConfig.response_data_path);
            sendLog(`목록 조회 페이지 ${page}에서 ${items.length}건 추출`);
            
            // 디버그: 첫 번째 항목의 필드 목록 출력
            if (items.length > 0 && page === 1) {
              const firstItem = items[0];
              const fieldKeys = Object.keys(firstItem);
              sendLog(`[DEBUG] 응답 필드 (${fieldKeys.length}개): ${fieldKeys.slice(0, 20).join(", ")}${fieldKeys.length > 20 ? "..." : ""}`);
            }

            if (items.length === 0) {
              sendLog("더 이상 데이터가 없습니다. 페이지네이션 종료.");
              break;
            }

            listItems.push(...items);

            // Rate limiting
            if (page < maxPages) {
              await delay(delayBetweenPages);
            }
          }
        }

        sendProgress("api_collect", `목록 조회 완료: 총 ${listItems.length}건`, 35);

        // ============================================================
        // 2단계: 본문 조회 API 호출 (2단계 모드인 경우)
        // 보조 엔드포인트(목록)에서 얻은 필드값을 주 엔드포인트(본문)에 전달
        // ============================================================
        if (isTwoPhaseMode && listItems.length > 0) {
          sendLog("");
          sendLog("── 📄 본문 조회 시작 (주 엔드포인트) ──");
          
          // filter_mappings 적용: 주 엔드포인트의 검색필터로 보조 엔드포인트 결과 필터링
          // 단, use_filter_keywords 모드에서는 이미 정확한 키워드로 검색했으므로 필터링 건너뜀
          let filteredListItems = listItems;
          const filterMappingsConfig = twoPhase?.filter_mappings ?? [];
          const skipFilterMapping = useFilterKeywords; // 키워드별 순차 검색 모드에서는 필터링 불필요
          
          if (!skipFilterMapping && filterMappingsConfig.length > 0 && apiConfig.search_filters && apiConfig.search_filters.length > 0) {
            sendLog(`── 🔍 필터 매핑 적용 (${filterMappingsConfig.length}개) ──`);
            
            // 디버그: 목록에서 가져온 데이터의 실제 필드값 출력 (최대 5건)
            for (const fm of filterMappingsConfig) {
              sendLog(`[DEBUG] ${fm.secondary_field} 필드 샘플값 (최대 5건):`);
              for (let i = 0; i < Math.min(5, listItems.length); i++) {
                const item = listItems[i];
                const fieldValue = getNestedValue(item, fm.secondary_field);
                sendLog(`  ${i + 1}. ${fieldValue ?? "(없음)"}`);
              }
            }
            
            filteredListItems = listItems.filter((item) => {
              for (const fm of filterMappingsConfig) {
                const filter = apiConfig.search_filters?.[fm.primary_filter_idx];
                if (!filter) continue;
                
                const fieldValue = getNestedValue(item, fm.secondary_field);
                if (fieldValue === undefined || fieldValue === null) continue;
                
                const fieldValueStr = String(fieldValue);
                const keywords = filter.keywords || [];
                
                // match_type에 따라 필터링 (SearchFilter: any/contains/exact/regex)
                let matched = false;
                switch (filter.match_type) {
                  case "exact":
                    matched = keywords.some((kw) => fieldValueStr === kw);
                    break;
                  case "regex":
                    matched = keywords.some((kw) => {
                      try {
                        return new RegExp(kw, "i").test(fieldValueStr);
                      } catch {
                        return false;
                      }
                    });
                    break;
                  case "any":
                  case "contains":
                  default:
                    matched = keywords.some((kw) => fieldValueStr.includes(kw));
                    break;
                }
                
                if (!matched) return false;
              }
              return true;
            });
            
            sendLog(`필터 매핑 적용 결과: ${listItems.length}건 → ${filteredListItems.length}건`);
            
            // 필터링 결과가 없으면 로그 출력
            if (filteredListItems.length === 0) {
              sendLog("[WARN] 필터 매핑 결과 매칭되는 항목이 없습니다. 검색필터 키워드를 확인하세요.");
              for (const fm of filterMappingsConfig) {
                const filter = apiConfig.search_filters?.[fm.primary_filter_idx];
                if (filter) {
                  sendLog(`  - 필터: ${filter.field} 키워드: ${filter.keywords.join(", ")}`);
                  sendLog(`  - 적용 필드: ${fm.secondary_field}`);
                }
              }
              sendLog("[HINT] 보조 엔드포인트의 query 파라미터에 검색어를 추가하거나, 페이지네이션을 늘려보세요.");
            }
          } else if (skipFilterMapping) {
            sendLog("[INFO] 키워드별 순차 검색 모드: 이미 정확한 키워드로 검색했으므로 필터 매핑 적용 건너뜀");
          }
          
          // 목록에서 최대 조회 건수만큼 사용 (maxListItems 적용)
          const limitedListItems = filteredListItems.slice(0, maxListItems);
          const itemsToFetch = limitedListItems.slice(0, maxDetailItems);
          
          sendLog(`목록 항목: ${filteredListItems.length}건, 본문 조회 대상: ${itemsToFetch.length}건 (최대 ${maxDetailItems}건)`);
          
          // 본문 조회 기본 파라미터 (주 엔드포인트의 params 사용)
          const detailBaseParams: Record<string, string> = {};
          // 주 엔드포인트(본문) 파라미터 적용
          if (apiConfig.params) {
            for (const [k, v] of Object.entries(apiConfig.params)) {
              if (v) detailBaseParams[k] = String(v);
            }
          }
          // primary_endpoint 자체 params도 적용
          if (apiConfig.primary_endpoint.params) {
            for (const [k, v] of Object.entries(apiConfig.primary_endpoint.params)) {
              if (v) detailBaseParams[k] = String(v);
            }
          }
          
          for (let i = 0; i < itemsToFetch.length; i++) {
            const item = itemsToFetch[i];
            const progressPercent = 35 + Math.floor(((i + 1) / itemsToFetch.length) * 20);
            
            // 다중 필드 매핑 적용: 보조(목록) 응답 필드 → 주(본문) 요청 파라미터
            const mappedParams: Record<string, string> = { ...detailBaseParams };
            let mappingSuccess = true;
            const mappedValues: string[] = [];
            
            for (const mapping of fieldMappings) {
              const fieldValue = extractIdFromListItem(item, mapping.source_field);
              if (!fieldValue) {
                sendLog(`[WARN] 항목 ${i + 1}: 필드(${mapping.source_field})를 찾을 수 없음`);
                mappingSuccess = false;
                break;
              }
              mappedParams[mapping.target_param] = fieldValue;
              mappedValues.push(`${mapping.target_param}=${fieldValue}`);
            }
            
            if (!mappingSuccess) continue;
            
            // 항목 제목 추출
            const itemTitle = extractItemTitle(item, apiConfig.title_field);
            sendProgress("api_collect", `본문 조회 ${i + 1}/${itemsToFetch.length}: ${itemTitle.slice(0, 30)}...`, progressPercent);
            
            const detailLogs: string[] = [];
            // 주 엔드포인트(본문)로 호출
            const detailResult = await executeDetailApiCallWithParams(
              apiProfile,
              apiConfig.primary_endpoint,
              mappedParams,
              detailLogs
            );
            
            for (const log of detailLogs) {
              sendLog(log);
            }
            
            if (detailResult.error) {
              sendLog(`[WARN] 본문 조회 실패 (${mappedValues.join(", ")}): ${detailResult.error}`);
              allData.push({ ...item, _detail_error: detailResult.error });
            } else {
              // 본문(detail) 응답은 국가법령정보처럼 최상위 루트가 곧 문서(<법령>)인 경우가 많음
              // → 루트 객체를 먼저 추출한 뒤, 그 객체를 기준으로 필드 추출/평탄화를 진행해야 조문이 누락되지 않음
              const detailRoot = extractDetailRootObject(detailResult.data) ?? detailResult.data;
              allData.push({ ...item, _detail: detailRoot, _from_list: item });
              
              // 원본 XML과 계층 구조 데이터 수집 (법령 서식용)
              if (detailResult.rawXml) {
                rawXmlResponses.push(detailResult.rawXml);
              }
              if (detailResult.hierarchicalData) {
                const hierarchical = extractDetailRootObject(detailResult.hierarchicalData) ?? detailResult.hierarchicalData;
                hierarchicalDataList.push(hierarchical);
              }
              
              sendLog(`본문 조회 성공: ${mappedValues.join(", ")} (detail_root_keys=${typeof detailRoot === "object" ? Object.keys(detailRoot).slice(0, 5).join(", ") : "n/a"})`);
            }
            
            // Rate limiting
            if (i < itemsToFetch.length - 1) {
              await delay(delayBetweenRequests);
            }
          }
          
          sendProgress("api_collect", `본문 조회 완료: ${allData.length}건`, 55);
        } else {
          allData = listItems;
          sendProgress("api_collect", `API 호출 완료: 총 ${allData.length}건`, 55);
        }

        // 검색 필터 적용
        if (apiConfig.search_filters && apiConfig.search_filters.length > 0) {
          sendProgress("filter", "검색 필터 적용 중...", 60);
          const beforeCount = allData.length;
          allData = applySearchFilters(allData, apiConfig.search_filters);
          sendLog(`검색 필터 적용: ${beforeCount}건 → ${allData.length}건`);
          sendProgress("filter", `필터링 완료: ${allData.length}건`, 70);
        }

        // 응답 필드 필터링
        if (apiConfig.response_fields && apiConfig.response_fields.length > 0) {
          sendProgress("filter", "응답 필드 필터링 중...", 75);
          sendLog(`[DEBUG] 선택된 필드 (${apiConfig.response_fields.length}개): ${apiConfig.response_fields.slice(0, 10).join(", ")}...`);
          
          // 필터링 전 데이터 필드 확인
          if (allData.length > 0) {
            const availableFields = Object.keys(allData[0]);
            const matchingFields = apiConfig.response_fields.filter(f => availableFields.includes(f));
            sendLog(`[DEBUG] 매칭된 필드 (${matchingFields.length}개): ${matchingFields.slice(0, 10).join(", ")}${matchingFields.length > 10 ? "..." : ""}`);
          }
          
          allData = filterResponseFields(allData, apiConfig.response_fields);
          sendLog(`선택된 필드만 추출 완료 (필터링 후 첫 항목 필드: ${allData.length > 0 ? Object.keys(allData[0]).join(", ") : "없음"})`);
        }

        // 결과 저장
        if (allData.length > 0) {
          sendProgress("save", "결과 저장 중...", 80);

          // 문서 유형에 따른 출력 옵션 설정
          const docType = board.doc_type || "";
          const exportOptions = {
            docType,
            rawXmlResponses: rawXmlResponses.length > 0 ? rawXmlResponses : undefined,
            hierarchicalData: hierarchicalDataList.length > 0 ? hierarchicalDataList : undefined,
          };

          sendLog(`[EXPORT] 문서 유형: ${docType || "일반"}, 원본 XML: ${rawXmlResponses.length}건, 계층 데이터: ${hierarchicalDataList.length}건`);

          const exportResult = await exportApiData(allData, board.board_name, API_SAVE_DIR, undefined, exportOptions);

          if (exportResult.success) {
            if (exportResult.xlsxPath) {
              sendLog(`XLSX 저장: ${exportResult.xlsxPath}`);
            } else if (docType === "법령") {
              sendLog(`[INFO] 법령 문서이므로 XLSX는 생성하지 않았습니다.`);
            }
            sendLog(`JSON 저장: ${exportResult.jsonPath}`);
            if (exportResult.docxPath) {
              sendLog(`DOCX 저장: ${exportResult.docxPath}`);
            }
            if (exportResult.xmlPath) {
              sendLog(`XML 저장: ${exportResult.xmlPath}`);
            }
            sendProgress("save", "파일 저장 완료", 95);

            sendProgress("done", "API 즉시 실행 완료!", 100);

            sendEvent("complete", {
              data: {
                success: true,
                boardId: boardId,
                boardName: board.board_name,
                dataCount: allData.length,
                xlsxPath: exportResult.xlsxPath,
                jsonPath: exportResult.jsonPath,
                saveDir: API_SAVE_DIR,
                logs: logs.join("\n"),
              },
            });
          } else {
            sendLog(`저장 실패: ${exportResult.error}`);
            sendEvent("error", { message: `저장 실패: ${exportResult.error}` });
          }
        } else {
          sendProgress("done", "수집된 데이터가 없습니다.", 100);
          sendEvent("complete", {
            data: {
              success: true,
              boardId: boardId,
              boardName: board.board_name,
              dataCount: 0,
              xlsxPath: "",
              jsonPath: "",
              saveDir: API_SAVE_DIR,
              logs: logs.join("\n"),
            },
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        sendLog(`[FATAL ERROR] ${errorMsg}`);
        sendEvent("error", { message: errorMsg });
      } finally {
        controller.close();
      }
    },
    cancel() {
      console.log("API Stream: Client disconnected");
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
