/**
 * API 즉시 실행
 * 
 * 보드의 api_config 설정에 따라 API를 호출하고 결과를 저장합니다.
 */

import { NextResponse } from "next/server";
import { readScraperTargets, type Board } from "@/lib/scraper/targets-store";
import { exportApiData, cleanupApiTestFiles } from "@/lib/scraper/api-export";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 300; // 5분 제한

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
// 타입 정의
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

interface ApiConfig {
  primary_endpoint: {
    name: string;
    path: string;
    method: string;
  };
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
}

interface ApiProfile {
  base_url: string;
  auth?: {
    type: string;
    in?: string;
    param_name?: string;
    name?: string;
    secret_ref?: string;
  };
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

    // relative_days 처리
    if (df.relative_days && df.relative_days > 0) {
      const pastDate = new Date(today);
      pastDate.setDate(pastDate.getDate() - df.relative_days);
      startDate = formatDateForApi(pastDate, df.format);
      endDate = formatDateForApi(today, df.format);
    }

    // 필드명에 따라 파라미터 설정
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
// 검색 필터 적용 (응답 데이터 필터링)
// ============================================================

function getNestedValue(obj: any, path: string): any {
  // 직접 키로 접근 시도
  if (obj[path] !== undefined) return obj[path];
  
  // 점(.) 구분자로 중첩 접근 시도
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function applySearchFilters(data: any[], searchFilters?: SearchFilter[], logs: string[] = []): any[] {
  if (!searchFilters || searchFilters.length === 0) return data;

  logs.push(`[FILTER] 검색 필터 적용 중...`);
  
  return data.filter((item) => {
    for (const filter of searchFilters) {
      const value = getNestedValue(item, filter.field);
      
      if (value === undefined || value === null) {
        // 필드가 없으면 필터 통과 (선택적 필터링)
        continue;
      }

      const strValue = String(value);
      
      // match_type에 따른 필터링
      let matches = false;
      
      switch (filter.match_type) {
        case "exact":
          // 정확히 일치
          matches = filter.keywords.some((keyword) => strValue === keyword);
          break;
          
        case "regex":
          // 정규식 매칭
          matches = filter.keywords.some((keyword) => {
            try {
              return new RegExp(keyword, "i").test(strValue);
            } catch {
              return false;
            }
          });
          break;
          
        case "any":
          // 키워드 중 하나라도 포함 (OR 조건)
          matches = filter.keywords.some((keyword) =>
            strValue.toLowerCase().includes(keyword.toLowerCase())
          );
          break;
          
        case "contains":
        default:
          // 기본: 키워드 포함 확인
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

function filterResponseFields(data: any[], responseFields?: string[], logs: string[] = []): any[] {
  if (!responseFields || responseFields.length === 0) {
    logs.push(`[FIELDS] 필드 필터 없음 - 모든 필드 반환`);
    return data;
  }

  logs.push(`[FIELDS] 선택된 필드만 추출: ${responseFields.join(", ")}`);
  
  return data.map((item) => {
    const filtered: Record<string, any> = {};
    
    for (const field of responseFields) {
      // 먼저 직접 키로 접근
      if (item[field] !== undefined) {
        filtered[field] = item[field];
      } else {
        // 중첩 경로로 접근 시도
        const value = getNestedValue(item, field);
        if (value !== undefined) {
          filtered[field] = value;
        }
      }
    }
    
    return filtered;
  });
}

// ============================================================
// API 응답에서 데이터 추출
// ============================================================

function extractDataFromResponse(response: any, logs: string[] = []): any[] {
  // JSON 응답 처리
  if (typeof response === "object") {
    // 배열인 경우 직접 반환
    if (Array.isArray(response)) {
      logs.push(`[EXTRACT] 직접 배열 응답: ${response.length}건`);
      return response;
    }

    // 국가법령정보센터 API 특수 처리 (LawSearch.law)
    if (response.LawSearch?.law) {
      const lawData = response.LawSearch.law;
      const result = Array.isArray(lawData) ? lawData : [lawData];
      logs.push(`[EXTRACT] LawSearch.law 경로: ${result.length}건`);
      return result;
    }

    // 일반적인 응답 구조에서 데이터 배열 찾기
    const commonPaths = [
      "data", "items", "results", "records", "list", "rows", "content", "law",
      "법령", "법령목록", "결과", "목록",
    ];

    for (const key of commonPaths) {
      if (response[key]) {
        if (Array.isArray(response[key])) {
          logs.push(`[EXTRACT] ${key} 경로: ${response[key].length}건`);
          return response[key];
        }
        // 중첩된 경우
        for (const subKey of commonPaths) {
          if (response[key][subKey] && Array.isArray(response[key][subKey])) {
            logs.push(`[EXTRACT] ${key}.${subKey} 경로: ${response[key][subKey].length}건`);
            return response[key][subKey];
          }
        }
        // 배열이 아닌 단일 객체인 경우
        if (typeof response[key] === "object") {
          logs.push(`[EXTRACT] ${key} 경로 (단일 객체)`);
          return [response[key]];
        }
      }
    }

    // 찾지 못한 경우 전체를 하나의 항목으로 반환
    logs.push(`[EXTRACT] 전체 응답을 단일 항목으로 처리`);
    return [response];
  }

  // XML 텍스트 응답 처리
  if (typeof response === "string" && response.trim().startsWith("<")) {
    logs.push(`[EXTRACT] XML 텍스트 응답`);
    return [{ raw_xml: response }];
  }

  return [];
}

// ============================================================
// API 호출 실행
// ============================================================

async function executeApiCall(
  apiProfile: ApiProfile,
  apiConfig: ApiConfig,
  pageParams?: Record<string, string>,
  logs: string[] = []
): Promise<{ data: any; error?: string }> {
  const baseUrl = apiProfile.base_url;
  if (!baseUrl) {
    return { data: null, error: "base_url이 설정되지 않았습니다." };
  }

  const endpoint = apiConfig.primary_endpoint;
  if (!endpoint.path) {
    return { data: null, error: "endpoint path가 설정되지 않았습니다." };
  }

  try {
    const url = new URL(endpoint.path, baseUrl);

    // 1. 사용자 설정 파라미터 적용 (api_config.params)
    let params = { ...apiConfig.params };

    // 2. 날짜 필터 적용
    params = applyDateFilters(params, apiConfig.date_filters);

    // 3. 페이지네이션 파라미터 적용 (기존 params를 덮어씀)
    if (pageParams) {
      params = { ...params, ...pageParams };
    }

    // 4. URL에 파라미터 설정
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }

    // 5. 인증 처리
    const headers: Record<string, string> = {
      "User-Agent": "EcoMonitorBot/1.0 (api_scraper)",
      Accept: "application/json, application/xml, text/xml, */*",
    };

    if (apiProfile.auth) {
      const auth = apiProfile.auth;
      const authIn = (auth.in || "query").toLowerCase();
      const authName = auth.param_name || auth.name || "";
      const secret = getEnvSecret(auth.secret_ref);

      if (secret && authName) {
        if (authIn === "header") {
          headers[authName] = secret;
        } else {
          url.searchParams.set(authName, secret);
        }
        logs.push(`[AUTH] 인증 파라미터 "${authName}" 적용됨`);
      }
    }

    logs.push(`[API] ${endpoint.method || "GET"} ${url.toString()}`);

    const response = await fetch(url.toString(), {
      method: endpoint.method || "GET",
      headers,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const contentType = response.headers.get("content-type") || "";

    // 응답 파싱
    let data;
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else if (contentType.includes("xml")) {
      const text = await response.text();
      data = { raw_xml: text, content_type: contentType };
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw_text: text, content_type: contentType };
      }
    }

    return { data };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { data: null, error: errorMsg };
  }
}

// ============================================================
// POST 핸들러 (즉시 실행)
// ============================================================

export async function POST(req: Request) {
  const logs: string[] = [];
  let allData: any[] = [];

  try {
    const body = await req.json();
    const { board_id } = body;

    if (!board_id) {
      return NextResponse.json({ error: "board_id is required" }, { status: 400 });
    }

    logs.push("========================================");
    logs.push("       🚀 API 즉시 실행 시작");
    logs.push("========================================");
    logs.push(`[INFO] 보드 ID: ${board_id}`);

    // 보드 설정 로드
    const targetsData = readScraperTargets();
    const board = targetsData.boards.find((b) => b.board_id === board_id);

    if (!board) {
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    }

    logs.push(`[INFO] 보드명: ${board.board_name}`);
    logs.push(`[INFO] 보드 모드: ${board.board_mode || board.access_mode}`);

    // API 설정 확인
    const apiConfig = board.api_config as ApiConfig | undefined;
    if (!apiConfig || !apiConfig.primary_endpoint) {
      return NextResponse.json({ error: "API 설정(api_config)이 없습니다." }, { status: 400 });
    }

    // 설정 정보 로깅
    logs.push("");
    logs.push("── 📋 API 설정 정보 ──");
    logs.push(`[CONFIG] 엔드포인트: ${apiConfig.primary_endpoint.name || apiConfig.primary_endpoint.path}`);
    logs.push(`[CONFIG] 경로: ${apiConfig.primary_endpoint.path}`);
    logs.push(`[CONFIG] 메서드: ${apiConfig.primary_endpoint.method || "GET"}`);
    
    // 요청 파라미터 로깅
    logs.push(`[CONFIG] 요청 파라미터:`);
    for (const [key, value] of Object.entries(apiConfig.params || {})) {
      if (value) logs.push(`         - ${key}: ${value}`);
    }
    
    // 페이지네이션 설정 로깅
    if (apiConfig.pagination) {
      logs.push(`[CONFIG] 페이지네이션:`);
      logs.push(`         - 타입: ${apiConfig.pagination.type}`);
      logs.push(`         - 파라미터: ${apiConfig.pagination.param_name}`);
      logs.push(`         - 페이지 크기: ${apiConfig.pagination.page_size}`);
      logs.push(`         - 최대 페이지: ${apiConfig.pagination.max_pages}`);
    }
    
    // 응답 필드 설정 로깅
    if (apiConfig.response_fields && apiConfig.response_fields.length > 0) {
      logs.push(`[CONFIG] 선택된 응답 필드 (${apiConfig.response_fields.length}개):`);
      logs.push(`         ${apiConfig.response_fields.join(", ")}`);
    } else {
      logs.push(`[CONFIG] 응답 필드: 전체 필드 수집`);
    }
    
    // 검색 필터 설정 로깅
    if (apiConfig.search_filters && apiConfig.search_filters.length > 0) {
      logs.push(`[CONFIG] 검색 필터 (${apiConfig.search_filters.length}개):`);
      for (const filter of apiConfig.search_filters) {
        logs.push(`         - 필드: ${filter.field}, 키워드: [${filter.keywords.join(", ")}], 타입: ${filter.match_type}`);
      }
    }

    // 기관 정보에서 api_profile 로드
    const org = targetsData.orgs.find((o) => o.org_id === board.org_id);
    if (!org) {
      return NextResponse.json({ error: "기관 정보를 찾을 수 없습니다." }, { status: 404 });
    }

    const apiProfile = (org.api_profile || {}) as unknown as ApiProfile;
    logs.push("");
    logs.push(`[INFO] 기관: ${org.org_name}`);
    logs.push(`[INFO] Base URL: ${apiProfile.base_url || org.base_url}`);

    // base_url이 없으면 org.base_url 사용
    if (!apiProfile.base_url && org.base_url) {
      apiProfile.base_url = org.base_url;
    }

    // 페이지네이션 설정
    const pagination = apiConfig.pagination;
    const maxPages = pagination?.max_pages || 1;
    const pageSize = pagination?.page_size || 10;
    const pageParam = pagination?.param_name || "page";

    logs.push("");
    logs.push("── 📡 API 호출 시작 ──");

    // 페이지별 호출
    for (let page = 1; page <= maxPages; page++) {
      logs.push(`\n[PAGE ${page}/${maxPages}]`);

      // 페이지네이션 파라미터 설정
      let pageParams: Record<string, string> = {};
      if (pagination && pagination.type !== "none") {
        switch (pagination.type) {
          case "page":
            pageParams[pageParam] = String(page);
            break;
          case "offset":
            pageParams[pageParam] = String((page - 1) * pageSize);
            break;
        }
      }

      const result = await executeApiCall(apiProfile, apiConfig, pageParams, logs);

      if (result.error) {
        logs.push(`[ERROR] ${result.error}`);
        break;
      }

      // 데이터 추출
      const items = extractDataFromResponse(result.data, logs);

      if (items.length === 0) {
        logs.push("[INFO] 더 이상 데이터가 없습니다. 페이지네이션 종료.");
        break;
      }

      allData.push(...items);

      // Rate limiting
      if (page < maxPages) {
        await delay(500);
      }
    }

    logs.push("");
    logs.push(`── ✅ API 호출 완료: 총 ${allData.length}건 ──`);

    // 검색 필터 적용 (키워드 필터링)
    if (apiConfig.search_filters && apiConfig.search_filters.length > 0) {
      logs.push("");
      logs.push("── 🔍 검색 필터 적용 ──");
      const beforeCount = allData.length;
      allData = applySearchFilters(allData, apiConfig.search_filters, logs);
      logs.push(`[FILTER] 필터링 결과: ${beforeCount}건 → ${allData.length}건`);
    }

    // 응답 필드 필터링
    if (apiConfig.response_fields && apiConfig.response_fields.length > 0) {
      logs.push("");
      logs.push("── 📝 응답 필드 필터링 ──");
      allData = filterResponseFields(allData, apiConfig.response_fields, logs);
    }

    // 결과 저장
    if (allData.length > 0) {
      logs.push("");
      logs.push("── 💾 결과 저장 ──");

      // 필드 필터링은 이미 적용되었으므로 exportApiData에 전달하지 않음
      const exportResult = await exportApiData(allData, board.board_name, API_SAVE_DIR);

      if (exportResult.success) {
        logs.push(`[SUCCESS] XLSX 저장: ${exportResult.xlsxPath}`);
        logs.push(`[SUCCESS] JSON 저장: ${exportResult.jsonPath}`);
      } else {
        logs.push(`[ERROR] 저장 실패: ${exportResult.error}`);
      }

      logs.push("");
      logs.push("========================================");
      logs.push("       🎉 API 즉시 실행 완료");
      logs.push("========================================");
      logs.push(`[SUMMARY]`);
      logs.push(`  - 수집 데이터: ${allData.length}건`);
      logs.push(`  - XLSX 파일: ${exportResult.xlsxPath || "(없음)"}`);
      logs.push(`  - JSON 파일: ${exportResult.jsonPath || "(없음)"}`);
      if (exportResult.docxPath) {
        logs.push(`  - DOCX 파일: ${exportResult.docxPath}`);
      }

      return NextResponse.json({
        success: true,
        boardId: board_id,
        boardName: board.board_name,
        dataCount: allData.length,
        xlsxPath: exportResult.xlsxPath,
        jsonPath: exportResult.jsonPath,
        docxPath: exportResult.docxPath,
        saveDir: API_SAVE_DIR,
        logs: logs.join("\n"),
      });
    } else {
      logs.push("[INFO] 수집된 데이터가 없습니다.");

      return NextResponse.json({
        success: true,
        boardId: board_id,
        boardName: board.board_name,
        dataCount: 0,
        xlsxPath: "",
        jsonPath: "",
        saveDir: API_SAVE_DIR,
        logs: logs.join("\n"),
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logs.push(`[FATAL ERROR] ${errorMsg}`);

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        logs: logs.join("\n"),
      },
      { status: 500 }
    );
  }
}

// ============================================================
// DELETE 핸들러 (테스트 파일 삭제)
// ============================================================

export async function DELETE(req: Request) {
  try {
    const result = cleanupApiTestFiles(API_SAVE_DIR);

    return NextResponse.json({
      success: result.success,
      deleted: result.deleted,
      errors: result.errors,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
