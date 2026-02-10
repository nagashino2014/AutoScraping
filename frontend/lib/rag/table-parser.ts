/**
 * 통합환경관리계획서 표 직접 파싱 유틸리티
 * 
 * extracted.json의 표 데이터를 직접 파싱하여 구조화된 데이터로 변환합니다.
 * RAG/LLM 방식의 한계(10개 청크 제한)를 우회하여 수천 개의 시설 데이터를 100% 추출합니다.
 */

import { randomUUID } from "crypto";

// ============================================================================
// 타입 정의
// ============================================================================

/** 추출된 표 데이터 구조 */
export interface ExtractedTable {
  table_index: number;
  page_num: number;
  row_count: number;
  col_count: number;
  rows: string[][];
  is_merged: boolean;
  page_span: number[];
  merge_confidence: number;
}

/** 추출된 JSON 파일 전체 구조 */
export interface ExtractedDocument {
  file_id: string;
  file_name: string;
  extraction_date: string;
  total_pages: number;
  text_content: string;
  tables: ExtractedTable[];
  metadata?: any;
}

/** 표 유형 */
export type TableType =
  | "emission"           // 배출시설 목록
  | "prevention"         // 방지시설 목록
  | "emission-summary"   // 배출시설 총괄표
  | "overview"           // 허가신청 개요
  | "other-permit"       // 통합허가 외 인허가
  | "process-major"      // 대분류 공정 설명
  | "process-unit"       // 단위공정 설명
  | "process-emission"   // 단위공정별 배출시설
  | "material-balance"   // 물질수지
  | "substance-fuel"     // 사용물질 - 연료
  | "substance-raw"      // 사용물질 - 원료
  | "substance-air"      // 사용물질 - 공기
  | "substance-chemical" // 사용물질 - 화학물질
  | "substance-energy"   // 사용물질 - 에너지
  | "pollutant-air"      // 오염물질 배출량 - 대기
  | "pollutant-water"    // 오염물질 배출량 - 수질
  | "pollutant-soil"     // 오염물질 배출량 - 토양
  | "pollutant-waste"    // 오염물질 배출량 - 폐기물
  | "permit-event"       // 허가 추진경과 (날짜별 이벤트)
  | "permit-facility"    // 허가 추진경과 (시설 목록)
  | "permit-emission-change" // 허가 추진경과 (발생량 변경)
  | "unknown";

// ============================================================================
// 표 유형 식별 함수
// ============================================================================

/**
 * 표 헤더를 분석하여 표 유형을 식별합니다.
 * @param table 추출된 표 데이터
 * @returns 식별된 표 유형
 */
export function identifyTableType(table: ExtractedTable): TableType {
  if (!table.rows || table.rows.length === 0) {
    return "unknown";
  }

  // 헤더 행 추출 (첫 1-3행을 검사)
  const headerRows = table.rows.slice(0, Math.min(3, table.rows.length));
  const allHeaders = headerRows.flat().map(h => normalizeHeader(h));
  const firstRowHeaders = table.rows[0].map(h => normalizeHeader(h));
  
  // 첫 번째 데이터 행 (헤더 다음)
  const firstDataRow = table.rows.length > 1 ? table.rows[1] : [];

  // ============================================================================
  // 배출시설/방지시설 표 식별
  // ============================================================================
  
  // 배출시설/방지시설 총괄표
  if (containsAll(allHeaders, ["공정분류", "공정번호", "총시설"]) ||
      containsAll(allHeaders, ["공정분류", "배출시설", "방지시설"])) {
    return "emission-summary";
  }

  // 배출시설 또는 방지시설 목록 (관리번호로 구분)
  if (containsAll(allHeaders, ["관리번호", "공정번호", "시설번호", "시설명"])) {
    // 첫 번째 데이터의 관리번호로 구분
    const firstMgmtNum = findFirstManagementNumber(table.rows);
    if (firstMgmtNum) {
      if (firstMgmtNum.startsWith("C-")) {
        return "prevention";
      } else if (firstMgmtNum.startsWith("I-")) {
        return "emission";
      }
    }
    // 기본값: 배출시설
    return "emission";
  }

  // ============================================================================
  // 개요 표 식별
  // ============================================================================

  if (containsAny(allHeaders, ["허가신청기관", "사업장명칭", "업종명"])) {
    return "overview";
  }

  if (containsAny(allHeaders, ["총량관리대상", "총량할당관리", "폐기물관련허가"])) {
    return "other-permit";
  }

  // ============================================================================
  // 공정 표 식별
  // ============================================================================

  // 대분류 공정 설명
  if (containsAll(allHeaders, ["구분", "공정분류", "공정번호", "공정명", "공정설명"]) ||
      containsAll(allHeaders, ["공정분류", "공정번호", "공정명"])) {
    return "process-major";
  }

  // 단위공정 설명
  if (containsAll(allHeaders, ["공정", "시설", "구분"]) &&
      containsAny(allHeaders, ["공정설명", "오염물질발생원리"])) {
    return "process-unit";
  }

  // 단위공정별 배출시설 (복합 표)
  if (containsAll(allHeaders, ["배출시설관리번호", "시설명", "용량"]) ||
      (containsAny(allHeaders, ["전단시설", "후단시설"]) && containsAny(allHeaders, ["시설명", "용량"]))) {
    return "process-emission";
  }

  // ============================================================================
  // 물질수지/사용물질 표 식별
  // ============================================================================

  // 물질수지 표 (동적 공정 열)
  if (containsAll(allHeaders, ["구분", "물질명", "단위", "물질수지"]) ||
      (containsAny(allHeaders, ["투입물", "산출물"]) && containsAny(allHeaders, ["물질명", "단위"]))) {
    return "material-balance";
  }

  // 연료 표
  if (containsAll(allHeaders, ["연료명", "발열량"]) ||
      (containsAny(allHeaders, ["연료", "황함량", "회분함량"]) && containsAny(allHeaders, ["투입시설", "최대사용량"]))) {
    return "substance-fuel";
  }

  // 원료/부원료 표
  if (containsAll(allHeaders, ["물질명", "투입방식", "용도"]) &&
      !containsAny(allHeaders, ["연료명", "발열량"])) {
    return "substance-raw";
  }

  // 공기 표
  if (containsAll(allHeaders, ["처리시설유무", "투입물함유산소"]) ||
      (containsAny(allHeaders, ["공기", "연소공기"]) && containsAny(allHeaders, ["투입시설", "재이용량"]))) {
    return "substance-air";
  }

  // 기타 화학물질 표
  if (containsAll(allHeaders, ["저장시설", "유해성"]) ||
      (containsAny(allHeaders, ["화학물질"]) && containsAny(allHeaders, ["성상", "유해성"]))) {
    return "substance-chemical";
  }

  // 에너지 표
  if (containsAll(allHeaders, ["수급구분", "수급시설", "사용처"]) ||
      (containsAny(allHeaders, ["전기", "증기"]) && containsAny(allHeaders, ["내부", "외부"]))) {
    return "substance-energy";
  }

  // ============================================================================
  // 오염물질 배출량 표 식별
  // ============================================================================

  // 대기오염물질 배출량
  if ((containsAny(allHeaders, ["굴뚝", "배출구", "#a"]) && containsAny(allHeaders, ["오염물질", "배출량", "농도"])) ||
      (containsAny(firstRowHeaders, ["먼지", "황산화물", "질소산화물", "nox", "sox"]))) {
    return "pollutant-air";
  }

  // 수질오염물질 배출량
  if ((containsAny(allHeaders, ["방류구", "#w"]) && containsAny(allHeaders, ["오염물질", "배출량", "농도"])) ||
      (containsAny(firstRowHeaders, ["bod", "cod", "ss", "t-n", "t-p"]))) {
    return "pollutant-water";
  }

  // 토양오염물질
  if (containsAll(allHeaders, ["시료구분", "오염물질"]) &&
      containsAny(allHeaders, ["토양", "배출농도"])) {
    return "pollutant-soil";
  }

  // 폐기물
  if ((containsAny(allHeaders, ["폐기물명", "분류코드"]) && containsAny(allHeaders, ["배출량", "최대", "최소"])) ||
      (containsAny(allHeaders, ["일반폐기물", "지정폐기물"]))) {
    return "pollutant-waste";
  }

  // ============================================================================
  // 허가 추진경과 표 식별
  // ============================================================================

  // 날짜별 이벤트
  if (table.col_count <= 3 && hasDatePattern(table.rows)) {
    return "permit-event";
  }

  // 시설 목록 (중첩 표 형태)
  if (containsAll(allHeaders, ["배출시설명", "용량", "수량", "방지시설명"])) {
    return "permit-facility";
  }

  // 발생량 변경
  if (containsAll(allHeaders, ["구분", "먼지", "황산화물", "질소산화물"]) ||
      containsAll(allHeaders, ["구분", "먼지", "계"])) {
    return "permit-emission-change";
  }

  return "unknown";
}

// ============================================================================
// 헬퍼 함수
// ============================================================================

/**
 * 헤더 문자열 정규화 (공백, 특수문자 제거, 소문자 변환)
 */
function normalizeHeader(header: string): string {
  if (!header) return "";
  return header
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z가-힣0-9#-]/g, "")
    .trim();
}

/**
 * 배열에 모든 키워드가 포함되어 있는지 확인
 */
function containsAll(headers: string[], keywords: string[]): boolean {
  const normalizedKeywords = keywords.map(k => normalizeHeader(k));
  return normalizedKeywords.every(keyword =>
    headers.some(h => h.includes(keyword))
  );
}

/**
 * 배열에 키워드 중 하나라도 포함되어 있는지 확인
 */
function containsAny(headers: string[], keywords: string[]): boolean {
  const normalizedKeywords = keywords.map(k => normalizeHeader(k));
  return normalizedKeywords.some(keyword =>
    headers.some(h => h.includes(keyword))
  );
}

/**
 * 표에서 첫 번째 관리번호 찾기
 */
function findFirstManagementNumber(rows: string[][]): string | null {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    for (const cell of row) {
      if (!cell) continue;
      // I-로 시작하거나 C-로 시작하는 관리번호 패턴
      const match = cell.match(/^[IC]-[A-Z]*\d+/i);
      if (match) return match[0].toUpperCase();
    }
  }
  return null;
}

/**
 * 표에 날짜 패턴이 있는지 확인
 */
function hasDatePattern(rows: string[][]): boolean {
  const datePattern = /○?\s*\d{4}\.\d{2}\.\d{2}/;
  for (const row of rows) {
    for (const cell of row) {
      if (cell && datePattern.test(cell)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 셀 값이 비어있거나 '-'인지 확인
 */
export function isEmptyCell(value: string): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" || trimmed === "－";
}

/**
 * 숫자 추출 (단위 포함 문자열에서)
 */
export function extractNumber(value: string): number | undefined {
  if (!value) return undefined;
  const match = value.replace(/,/g, "").match(/-?\d+\.?\d*/);
  if (match) {
    const num = parseFloat(match[0]);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

/**
 * 단위 추출
 */
export function extractUnit(value: string): string {
  if (!value) return "";
  // 숫자 제거 후 남은 문자열
  return value.replace(/[\d,.\s-]+/g, "").trim();
}

// ============================================================================
// 배출시설 파싱
// ============================================================================

export interface ParsedEmissionFacility {
  id: string;
  managementNumber: string;
  processNumber: string;
  facilityNumber: string;
  name: string;
  capacity?: number;
  capacityUnit: string;
  quantity: number;
  permitType: string;         // 인허가 항목
  emissionMedia: "air" | "water" | "waste" | "odor";
  pollutants: string[];
  operatingFactorDetail: string;
  installationLocation: string;
  dischargePortNumber: string;
  changeStatus: string;
  isLegalTarget: boolean;
  pidNumber: string;
  isMajorFacility: boolean;
  notes: string;
  isEmissionTarget: boolean;  // 대상시설 여부
}

/**
 * 배출시설 표 파싱
 * @param table 추출된 표 데이터
 * @returns 배출시설(대상)과 비배출시설(비대상) 분리
 */
export function parseEmissionFacilitiesTable(table: ExtractedTable): {
  emissions: ParsedEmissionFacility[];
  nonEmissions: ParsedEmissionFacility[];
} {
  const emissions: ParsedEmissionFacility[] = [];
  const nonEmissions: ParsedEmissionFacility[] = [];

  if (!table.rows || table.rows.length < 2) {
    return { emissions, nonEmissions };
  }

  // 헤더 행 찾기 (첫 1-2행 검사)
  let headerRowIndex = 0;
  let headers: string[] = [];
  
  for (let i = 0; i < Math.min(2, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("관리번호") || h.includes("시설번호"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "managementNumber", patterns: ["관리번호"] },
    { field: "processNumber", patterns: ["공정번호"] },
    { field: "facilityNumber", patterns: ["시설번호"] },
    { field: "name", patterns: ["시설명"] },
    { field: "capacity", patterns: ["용량"] },
    { field: "quantity", patterns: ["수량"] },
    { field: "permitType", patterns: ["인허가항목", "인허가", "항목"] },
    { field: "pollutants", patterns: ["배출오염물질", "오염물질"] },
    { field: "operatingFactor", patterns: ["운전인자"] },
    { field: "installationLocation", patterns: ["설치지점"] },
    { field: "dischargePort", patterns: ["배출구", "방류구", "배출(방류)구"] },
    { field: "changeStatus", patterns: ["변경사항"] },
    { field: "isLegalTarget", patterns: ["법적대상", "대상여부"] },
    { field: "pidNumber", patterns: ["p&id", "pid"] },
    { field: "isMajorFacility", patterns: ["주요시설"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 현재 관리번호 (행 병합 대응)
  let currentManagementNumber = "";
  let currentProcessNumber = "";
  let currentName = "";
  let currentCapacity: number | undefined;
  let currentCapacityUnit = "";
  let currentQuantity = 1;

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    // 관리번호가 있으면 새 시설 시작
    const mgmtNum = getCell(row, colMap.managementNumber);
    if (mgmtNum && !isEmptyCell(mgmtNum) && mgmtNum.match(/^I-/i)) {
      currentManagementNumber = mgmtNum.trim();
      currentProcessNumber = getCell(row, colMap.processNumber) || currentProcessNumber;
      currentName = getCell(row, colMap.name) || "";
      
      const capacityStr = getCell(row, colMap.capacity);
      currentCapacity = extractNumber(capacityStr);
      currentCapacityUnit = extractUnit(capacityStr);
      currentQuantity = extractNumber(getCell(row, colMap.quantity)) || 1;
    }

    // 시설번호가 있으면 해당 시설 정보 추출
    const facilityNumber = getCell(row, colMap.facilityNumber);
    
    // 관리번호 또는 시설번호가 있어야 유효한 행
    if (!currentManagementNumber && (!facilityNumber || isEmptyCell(facilityNumber))) {
      continue;
    }

    const permitType = getCell(row, colMap.permitType);
    const pollutantsStr = getCell(row, colMap.pollutants);
    const dischargePort = getCell(row, colMap.dischargePort);
    const isLegalTargetStr = getCell(row, colMap.isLegalTarget);

    // 대상시설 여부 판단 (인허가 항목, 배출오염물질, 배출구 번호에 데이터 존재)
    const isEmissionTarget = !isEmptyCell(permitType) || 
                             !isEmptyCell(pollutantsStr) || 
                             !isEmptyCell(dischargePort);

    // 배출 매체 판별
    let emissionMedia: "air" | "water" | "waste" | "odor" = "air";
    if (facilityNumber) {
      if (facilityNumber.startsWith("A-") || facilityNumber.match(/^AT-/i)) {
        emissionMedia = "air";
      } else if (facilityNumber.startsWith("W-") || facilityNumber.match(/^W[Ts]-/i)) {
        emissionMedia = "water";
      } else if (facilityNumber.startsWith("Ws-") || facilityNumber.match(/폐기물/)) {
        emissionMedia = "waste";
      } else if (facilityNumber.startsWith("O-") || facilityNumber.match(/^OT-/i)) {
        emissionMedia = "odor";
      }
    }
    if (permitType) {
      if (permitType.includes("대기")) emissionMedia = "air";
      else if (permitType.includes("수질") || permitType.includes("폐수")) emissionMedia = "water";
      else if (permitType.includes("폐기물")) emissionMedia = "waste";
      else if (permitType.includes("악취")) emissionMedia = "odor";
    }

    const facility: ParsedEmissionFacility = {
      id: randomUUID(),
      managementNumber: currentManagementNumber,
      processNumber: currentProcessNumber || getCell(row, colMap.processNumber) || "",
      facilityNumber: facilityNumber || "",
      name: currentName || getCell(row, colMap.name) || "",
      capacity: currentCapacity,
      capacityUnit: currentCapacityUnit,
      quantity: currentQuantity,
      permitType: permitType || "",
      emissionMedia,
      pollutants: pollutantsStr ? pollutantsStr.split(/[,，、\s]+/).filter(p => p.trim()) : [],
      operatingFactorDetail: getCell(row, colMap.operatingFactor) || "",
      installationLocation: getCell(row, colMap.installationLocation) || "",
      dischargePortNumber: dischargePort || "",
      changeStatus: getCell(row, colMap.changeStatus) || "existing",
      isLegalTarget: parseBoolean(isLegalTargetStr),
      pidNumber: getCell(row, colMap.pidNumber) || "",
      isMajorFacility: parseBoolean(getCell(row, colMap.isMajorFacility)),
      notes: getCell(row, colMap.notes) || "",
      isEmissionTarget,
    };

    if (isEmissionTarget) {
      emissions.push(facility);
    } else {
      nonEmissions.push(facility);
    }
  }

  return { emissions, nonEmissions };
}

// ============================================================================
// 방지시설 파싱
// ============================================================================

export interface ParsedPreventionFacility {
  id: string;
  managementNumber: string;
  processNumber: string;
  facilityNumber: string;
  name: string;
  capacity?: number;
  capacityUnit: string;
  quantity: number;
  treatmentType: string;      // 처리/발생
  pollutants: string[];
  operatingFactorDetail: string;
  installationLocation: string;
  dischargePortNumber: string;
  changeStatus: string;
  isLegalTarget: boolean;
  pidNumber: string;
  isMajorFacility: boolean;
  notes: string;
}

/**
 * 방지시설 표 파싱
 */
export function parsePreventionFacilitiesTable(table: ExtractedTable): ParsedPreventionFacility[] {
  const facilities: ParsedPreventionFacility[] = [];

  if (!table.rows || table.rows.length < 2) {
    return facilities;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];
  
  for (let i = 0; i < Math.min(2, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("관리번호") || h.includes("시설번호"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "managementNumber", patterns: ["관리번호"] },
    { field: "processNumber", patterns: ["공정번호"] },
    { field: "facilityNumber", patterns: ["시설번호"] },
    { field: "name", patterns: ["시설명"] },
    { field: "capacity", patterns: ["용량"] },
    { field: "unit", patterns: ["단위"] },
    { field: "quantity", patterns: ["수량"] },
    { field: "treatmentType", patterns: ["처리", "발생", "처리/발생"] },
    { field: "pollutants", patterns: ["오염물질"] },
    { field: "operatingFactor", patterns: ["운전인자"] },
    { field: "installationLocation", patterns: ["설치지점"] },
    { field: "dischargePort", patterns: ["배출구", "방류구"] },
    { field: "changeStatus", patterns: ["변경사항"] },
    { field: "isLegalTarget", patterns: ["법적대상", "대상여부"] },
    { field: "pidNumber", patterns: ["p&id", "pid"] },
    { field: "isMajorFacility", patterns: ["주요시설"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 현재 시설 정보 (행 병합 대응)
  let currentManagementNumber = "";
  let currentProcessNumber = "";
  let currentName = "";
  let currentCapacity: number | undefined;
  let currentCapacityUnit = "";
  let currentQuantity = 1;

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    // 관리번호가 있으면 새 시설 시작
    const mgmtNum = getCell(row, colMap.managementNumber);
    if (mgmtNum && !isEmptyCell(mgmtNum) && mgmtNum.match(/^C-/i)) {
      currentManagementNumber = mgmtNum.trim();
      currentProcessNumber = getCell(row, colMap.processNumber) || currentProcessNumber;
      currentName = getCell(row, colMap.name) || "";
      
      const capacityStr = getCell(row, colMap.capacity);
      currentCapacity = extractNumber(capacityStr);
      
      // 단위는 별도 열 또는 용량에서 추출
      const unitStr = getCell(row, colMap.unit);
      currentCapacityUnit = unitStr || extractUnit(capacityStr);
      
      currentQuantity = extractNumber(getCell(row, colMap.quantity)) || 1;
    }

    const facilityNumber = getCell(row, colMap.facilityNumber);
    
    // 관리번호가 있어야 유효한 행
    if (!currentManagementNumber) {
      continue;
    }

    const pollutantsStr = getCell(row, colMap.pollutants);

    const facility: ParsedPreventionFacility = {
      id: randomUUID(),
      managementNumber: currentManagementNumber,
      processNumber: currentProcessNumber || getCell(row, colMap.processNumber) || "",
      facilityNumber: facilityNumber || "",
      name: currentName || getCell(row, colMap.name) || "",
      capacity: currentCapacity,
      capacityUnit: currentCapacityUnit,
      quantity: currentQuantity,
      treatmentType: getCell(row, colMap.treatmentType) || "treatment",
      pollutants: pollutantsStr ? pollutantsStr.split(/[,，、\s]+/).filter(p => p.trim()) : [],
      operatingFactorDetail: getCell(row, colMap.operatingFactor) || "",
      installationLocation: getCell(row, colMap.installationLocation) || "",
      dischargePortNumber: getCell(row, colMap.dischargePort) || "",
      changeStatus: getCell(row, colMap.changeStatus) || "existing",
      isLegalTarget: parseBoolean(getCell(row, colMap.isLegalTarget)),
      pidNumber: getCell(row, colMap.pidNumber) || "",
      isMajorFacility: parseBoolean(getCell(row, colMap.isMajorFacility)),
      notes: getCell(row, colMap.notes) || "",
    };

    facilities.push(facility);
  }

  return facilities;
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 열 인덱스 맵 생성
 */
function buildColumnMap(
  headers: string[],
  mappings: { field: string; patterns: string[] }[]
): Record<string, number> {
  const map: Record<string, number> = {};

  for (const mapping of mappings) {
    for (let i = 0; i < headers.length; i++) {
      const normalizedPatterns = mapping.patterns.map(p => normalizeHeader(p));
      if (normalizedPatterns.some(pattern => headers[i].includes(pattern))) {
        map[mapping.field] = i;
        break;
      }
    }
  }

  return map;
}

/**
 * 행에서 특정 열의 셀 값 가져오기
 */
function getCell(row: string[], colIndex: number | undefined): string {
  if (colIndex === undefined || colIndex < 0 || colIndex >= row.length) {
    return "";
  }
  return row[colIndex] || "";
}

/**
 * 문자열을 boolean으로 파싱
 */
function parseBoolean(value: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "대상" || 
         normalized === "o" || 
         normalized === "○" || 
         normalized === "yes" || 
         normalized === "true" ||
         normalized === "y";
}

// ============================================================================
// 개요 데이터 파싱
// ============================================================================

/** 개요 데이터 타입 */
export interface ParsedOverview {
  ksicCodes: { code: string; name: string }[];    // 표준산업분류코드
  mainProducts: string;                            // 주요 생산품
  permitScale: {
    air: { grade: string; amount: string };        // 대기 종/배출량
    water: { grade: string; amount: string };      // 수질 종/배출량
  };
  permitsByMedia: {
    air: string[];       // 대기환경보전법 관련 항목
    water: string[];     // 물환경보전법 관련 항목
    waste: string[];     // 폐기물관리법 관련 항목
    noise: string[];     // 소음진동관리법 관련 항목
    others: string[];    // 기타 (악취, 토양, 잔류성 등)
  };
}

/** 통합허가 외 인허가 사항 타입 */
export interface ParsedOtherPermits {
  totalQuantityManagement: string[];               // 총량관리대상
  totalQuantityAllocation: {                       // 총량할당관리
    pollutant: string;
    unit: string;
    yearlyData: { year: number; amount: number }[];
  }[];
  wastePermits: string[];                          // 폐기물 관련 허가
  managedEquipment: boolean;                       // 관리대상기기 설치대상
  grayWater: boolean;                              // 중수도 설치대상
}

/**
 * 텍스트에서 개요 데이터 파싱
 * @param text 추출된 텍스트 내용
 * @returns 파싱된 개요 데이터
 */
export function parseOverviewFromText(text: string): ParsedOverview {
  const result: ParsedOverview = {
    ksicCodes: [],
    mainProducts: "",
    permitScale: {
      air: { grade: "", amount: "" },
      water: { grade: "", amount: "" },
    },
    permitsByMedia: {
      air: [],
      water: [],
      waste: [],
      noise: [],
      others: [],
    },
  };

  if (!text) return result;

  // 1. 표준산업분류코드 추출 (5자리 숫자)
  const ksicPattern = /(\d{5})[,\s]*([가-힣\s]+(?:제조업|업|서비스)?)/g;
  let ksicMatch;
  while ((ksicMatch = ksicPattern.exec(text)) !== null) {
    const code = ksicMatch[1];
    const name = ksicMatch[2].trim();
    // 중복 방지
    if (!result.ksicCodes.some(k => k.code === code)) {
      result.ksicCodes.push({ code, name });
    }
  }

  // 2. 주요 생산품 추출
  const productPatterns = [
    /주요\s*생산품[·:.\s]*([^\n]+)/i,
    /주요생산품[·:.\s]*생산량[·:.\s]*([^\n]+)/i,
  ];
  for (const pattern of productPatterns) {
    const match = text.match(pattern);
    if (match) {
      result.mainProducts = match[1].trim();
      break;
    }
  }

  // 3. 종규모 추출 (통합허가 기준)
  // 대기 종
  const airGradePattern = /대기\s*(\d)종\s*\(([^)]+)\)/;
  const airMatch = text.match(airGradePattern);
  if (airMatch) {
    result.permitScale.air.grade = `대기 ${airMatch[1]}종`;
    result.permitScale.air.amount = airMatch[2].trim();
  }

  // 수질 종
  const waterGradePattern = /수질\s*(\d)종\s*\(([^)]+)\)/;
  const waterMatch = text.match(waterGradePattern);
  if (waterMatch) {
    result.permitScale.water.grade = `수질 ${waterMatch[1]}종`;
    result.permitScale.water.amount = waterMatch[2].trim();
  }

  // 4. 매체별 인허가사항 추출 (체크박스 패턴)
  // 대기환경보전법 항목
  const airLawPatterns = [
    /[■☑✓].*대기환경보전법.*휘발성\s*유기화합물/,
    /[■☑✓].*대기환경보전법.*대기오염물질배출시설/,
    /[■☑✓].*대기환경보전법.*비산배출/,
    /[■☑✓].*대기환경보전법.*비산먼지/,
  ];
  const airLawItems = [
    "휘발성 유기화합물 배출시설",
    "대기오염물질배출시설",
    "비산배출시설",
    "비산먼지 발생사업",
  ];
  airLawPatterns.forEach((pattern, idx) => {
    if (pattern.test(text)) {
      result.permitsByMedia.air.push(airLawItems[idx]);
    }
  });

  // 물환경보전법 항목
  const waterLawPatterns = [
    /[■☑✓].*물환경보전법.*폐수배출시설/,
    /[■☑✓].*물환경보전법.*폐수무방류배출시설/,
  ];
  const waterLawItems = [
    "폐수배출시설",
    "폐수무방류배출시설",
  ];
  waterLawPatterns.forEach((pattern, idx) => {
    if (pattern.test(text)) {
      result.permitsByMedia.water.push(waterLawItems[idx]);
    }
  });

  // 폐기물관리법 항목
  if (/[■☑✓].*폐기물관리법/.test(text)) {
    result.permitsByMedia.waste.push("폐기물처리시설");
  }

  // 소음진동관리법 항목
  if (/[■☑✓].*소음.*진동관리법/.test(text)) {
    result.permitsByMedia.noise.push("소음진동 배출시설");
  }

  // 기타 항목
  if (/[■☑✓].*악취방지법/.test(text)) {
    result.permitsByMedia.others.push("악취배출시설");
  }
  if (/[■☑✓].*토양환경보전법/.test(text)) {
    result.permitsByMedia.others.push("토양오염관리대상시설");
  }
  if (/[■☑✓].*잔류성.*오염물질/.test(text)) {
    result.permitsByMedia.others.push("잔류성오염물질 배출시설");
  }

  return result;
}

/**
 * 개요 표 파싱 (허가 신청 사업장 표)
 * @param table 추출된 표 데이터
 * @returns 파싱된 개요 데이터
 */
export function parseOverviewTable(table: ExtractedTable): Partial<ParsedOverview> {
  const result: Partial<ParsedOverview> = {
    ksicCodes: [],
    mainProducts: "",
    permitScale: {
      air: { grade: "", amount: "" },
      water: { grade: "", amount: "" },
    },
  };

  if (!table.rows || table.rows.length === 0) {
    return result;
  }

  for (const row of table.rows) {
    const rowText = row.join(" ");
    
    // 업종명 행에서 KSIC 코드 추출
    if (rowText.includes("업종명") || rowText.match(/\d{5}/)) {
      const ksicPattern = /(\d{5})[,\s]*([가-힣\s]+(?:제조업|업)?)/g;
      let match;
      while ((match = ksicPattern.exec(rowText)) !== null) {
        const code = match[1];
        const name = match[2].trim();
        if (!result.ksicCodes!.some(k => k.code === code)) {
          result.ksicCodes!.push({ code, name });
        }
      }
    }

    // 주요 생산품 행
    if (rowText.includes("주요생산품") || rowText.includes("주요 생산품")) {
      const productMatch = rowText.match(/(?:주요\s*생산품[·:.\s]*)([^\n]+)/);
      if (productMatch) {
        result.mainProducts = productMatch[1].replace(/주요생산품|주요 생산품/g, "").trim();
      } else {
        // 다음 셀에 있을 수 있음
        const idx = row.findIndex(cell => cell.includes("주요생산품") || cell.includes("주요 생산품"));
        if (idx >= 0 && idx + 1 < row.length) {
          result.mainProducts = row[idx + 1].trim();
        }
      }
    }

    // 종규모 행
    if (rowText.includes("종규모") || rowText.includes("통합허가")) {
      // 대기 종
      const airMatch = rowText.match(/대기\s*(\d)종\s*\(([^)]+)\)/);
      if (airMatch) {
        result.permitScale!.air.grade = `대기 ${airMatch[1]}종`;
        result.permitScale!.air.amount = airMatch[2].trim();
      }
      // 수질 종
      const waterMatch = rowText.match(/수질\s*(\d)종\s*\(([^)]+)\)/);
      if (waterMatch) {
        result.permitScale!.water.grade = `수질 ${waterMatch[1]}종`;
        result.permitScale!.water.amount = waterMatch[2].trim();
      }
    }
  }

  return result;
}

/**
 * 통합허가 외 인허가사항 표 파싱
 * @param table 추출된 표 데이터  
 * @returns 파싱된 통합허가 외 인허가 데이터
 */
export function parseOtherPermitsTable(table: ExtractedTable): ParsedOtherPermits {
  const result: ParsedOtherPermits = {
    totalQuantityManagement: [],
    totalQuantityAllocation: [],
    wastePermits: [],
    managedEquipment: false,
    grayWater: false,
  };

  if (!table.rows || table.rows.length === 0) {
    return result;
  }

  for (const row of table.rows) {
    const rowText = row.join(" ");
    const normalizedText = rowText.toLowerCase();

    // 총량관리대상
    if (normalizedText.includes("총량관리대상") || normalizedText.includes("총량관리 대상")) {
      const pollutants = ["먼지", "황산화물", "질소산화물", "수질오염물질"];
      for (const pollutant of pollutants) {
        if (rowText.includes(pollutant) && (rowText.includes("○") || rowText.includes("■") || rowText.includes("√"))) {
          result.totalQuantityManagement.push(pollutant);
        }
      }
    }

    // 폐기물 관련 허가
    if (normalizedText.includes("폐기물처리업") || normalizedText.includes("종합재활용업") || normalizedText.includes("소각시설")) {
      if (rowText.includes("○") || rowText.includes("■") || rowText.includes("√") || rowText.includes("해당")) {
        if (rowText.includes("폐기물처리업")) result.wastePermits.push("폐기물처리업");
        if (rowText.includes("종합재활용업")) result.wastePermits.push("종합재활용업");
        if (rowText.includes("소각시설")) result.wastePermits.push("소각시설 설치승인");
      }
    }

    // 관리대상기기 설치대상
    if (normalizedText.includes("관리대상기기")) {
      result.managedEquipment = rowText.includes("○") || rowText.includes("■") || rowText.includes("√") || rowText.includes("해당");
    }

    // 중수도 설치대상
    if (normalizedText.includes("중수도")) {
      result.grayWater = rowText.includes("○") || rowText.includes("■") || rowText.includes("√") || rowText.includes("해당");
    }
  }

  return result;
}

// ============================================================================
// 공정 데이터 파싱
// ============================================================================

/** 대분류 공정 */
export interface ParsedMajorProcess {
  id: string;
  category: string;           // 구분 (예: 유틸리티공정)
  processCode: string;        // 공정분류 코드 (예: PU)
  processNumber: string;      // 공정번호 (예: PU-01)
  name: string;               // 공정명
  description: string;        // 공정설명
}

/** 단위공정 */
export interface ParsedUnitProcess {
  id: string;
  majorProcessCode: string;   // 대분류 공정 코드
  processCode: string;        // 단위공정 코드 (예: PU-01-01)
  facilityName: string;       // 시설명
  managementNumberRange: string;  // 관리번호 범위
  category: string;           // 구분 (공정설명, 수질배출, 폐기물배출 등)
  description: string;        // 공정설명 및 오염물질 발생원리
}

/** 단위공정별 배출시설 상세 */
export interface ParsedProcessEmission {
  id: string;
  managementNumber: string;   // 배출시설 관리번호
  name: string;               // 시설명
  capacity?: number;          // 용량
  capacityUnit: string;       // 단위
  quantity: number;           // 수량
  operatingPressure?: number; // 운전압력 (kPa)
  operatingTemperature?: number; // 운전온도 (℃)
  dailyOperatingHours?: number;  // 일일가동시간
  annualOperatingDays?: number;  // 연간가동일수
  upstreamFacility: string;   // 전단시설
  downstreamFacility: string; // 후단시설
  siteArea?: number;          // 부지면적 (m²)
  installationLocation: string; // 설치지점
  facilityMaterial: string;   // 시설재질
  thickness?: number;         // 두께 (mm)
  auxiliaryEquipment: string; // 부대설비명
  equipmentCount?: number;    // 설비개수
  // 오염물질 발생 정보
  pollutantInfo: ParsedProcessPollutant[];
}

/** 단위공정별 오염물질 발생 정보 */
export interface ParsedProcessPollutant {
  facilityNumber: string;     // 시설번호
  pollutantName: string;      // 오염물질명
  emissionConcentration?: number; // 발생농도
  emissionFactor?: number;    // 배출계수
  maxEmissionPerHour?: number;   // 최대발생량 - 시
  maxEmissionPerDay?: number;    // 최대발생량 - 일
  maxEmissionPerYear?: number;   // 최대발생량 - 연
  reductionMethod: string;    // 저감방법
  preventionFacilityNumbers: string[]; // 방지시설번호
  facilityStandardNumber: string;     // 시설기준번호
  facilityStandardContent: string;    // 시설기준적용내용
  notes: string;              // 비고
}

/**
 * 대분류 공정 표 파싱
 */
export function parseMajorProcessTable(table: ExtractedTable): ParsedMajorProcess[] {
  const processes: ParsedMajorProcess[] = [];

  if (!table.rows || table.rows.length < 2) {
    return processes;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(2, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("공정분류") || h.includes("공정번호"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "category", patterns: ["구분"] },
    { field: "processCode", patterns: ["공정분류"] },
    { field: "processNumber", patterns: ["공정번호"] },
    { field: "name", patterns: ["공정명"] },
    { field: "description", patterns: ["공정설명"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const processCode = getCell(row, colMap.processCode);
    const processNumber = getCell(row, colMap.processNumber);
    
    // 공정번호가 있어야 유효한 행
    if (!processNumber || isEmptyCell(processNumber)) {
      continue;
    }

    const process: ParsedMajorProcess = {
      id: randomUUID(),
      category: getCell(row, colMap.category) || "",
      processCode: processCode || "",
      processNumber: processNumber,
      name: getCell(row, colMap.name) || "",
      description: getCell(row, colMap.description) || "",
    };

    processes.push(process);
  }

  return processes;
}

/**
 * 단위공정 표 파싱
 */
export function parseUnitProcessTable(table: ExtractedTable): ParsedUnitProcess[] {
  const processes: ParsedUnitProcess[] = [];

  if (!table.rows || table.rows.length < 2) {
    return processes;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(2, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("공정") && h.includes("시설"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "process", patterns: ["공정"] },
    { field: "facility", patterns: ["시설"] },
    { field: "category", patterns: ["구분"] },
    { field: "description", patterns: ["공정설명", "오염물질발생원리"] },
  ]);

  // 현재 대분류 공정 코드 (행 병합 대응)
  let currentMajorCode = "";

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const processCell = getCell(row, colMap.process);
    const facilityCell = getCell(row, colMap.facility);
    
    // 대분류 공정 코드 추출
    const majorCodeMatch = processCell.match(/^([A-Z]+)-?\d*/i);
    if (majorCodeMatch && processCell.length < 10) {
      currentMajorCode = majorCodeMatch[0];
    }

    // 시설 정보에서 시설명과 관리번호 범위 추출
    let facilityName = "";
    let managementNumberRange = "";
    
    if (facilityCell) {
      // "기타(저장)시설 I-U101001 ~ I-U101002" 형태
      const rangeMatch = facilityCell.match(/([IC]-[A-Z\d]+)\s*~\s*([IC]-[A-Z\d]+)/i);
      if (rangeMatch) {
        managementNumberRange = `${rangeMatch[1]} ~ ${rangeMatch[2]}`;
        facilityName = facilityCell.replace(/[IC]-[A-Z\d]+\s*~\s*[IC]-[A-Z\d]+/i, "").trim();
      } else {
        const singleMatch = facilityCell.match(/([IC]-[A-Z\d]+)/i);
        if (singleMatch) {
          managementNumberRange = singleMatch[1];
          facilityName = facilityCell.replace(/[IC]-[A-Z\d]+/i, "").trim();
        } else {
          facilityName = facilityCell;
        }
      }
    }

    // 단위공정 코드 추출 (PU-01-01 형태)
    const unitCodeMatch = processCell.match(/([A-Z]+-\d+-\d+)/i);
    const processCode = unitCodeMatch ? unitCodeMatch[1] : processCell;

    if (!processCode || isEmptyCell(processCode)) {
      continue;
    }

    const process: ParsedUnitProcess = {
      id: randomUUID(),
      majorProcessCode: currentMajorCode,
      processCode: processCode,
      facilityName: facilityName,
      managementNumberRange: managementNumberRange,
      category: getCell(row, colMap.category) || "",
      description: getCell(row, colMap.description) || "",
    };

    processes.push(process);
  }

  return processes;
}

/**
 * 단위공정별 배출시설 상세 표 파싱 (복합 구조)
 */
export function parseProcessEmissionTable(table: ExtractedTable): ParsedProcessEmission[] {
  const emissions: ParsedProcessEmission[] = [];

  if (!table.rows || table.rows.length < 2) {
    return emissions;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(3, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("배출시설관리번호") || h.includes("관리번호"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑 (상단 테이블)
  const colMap = buildColumnMap(headers, [
    { field: "managementNumber", patterns: ["배출시설관리번호", "관리번호"] },
    { field: "name", patterns: ["시설명"] },
    { field: "capacity", patterns: ["용량"] },
    { field: "unit", patterns: ["단위"] },
    { field: "quantity", patterns: ["수량"] },
    { field: "operatingPressure", patterns: ["운전압력"] },
    { field: "operatingTemperature", patterns: ["운전온도"] },
    { field: "dailyOperatingHours", patterns: ["일일가동시간", "가동시간"] },
    { field: "annualOperatingDays", patterns: ["연간가동일수", "가동일수"] },
    { field: "upstreamFacility", patterns: ["전단시설"] },
    { field: "downstreamFacility", patterns: ["후단시설"] },
    { field: "siteArea", patterns: ["부지면적"] },
    { field: "installationLocation", patterns: ["설치지점"] },
    { field: "facilityMaterial", patterns: ["시설재질", "재질"] },
    { field: "thickness", patterns: ["두께"] },
    { field: "auxiliaryEquipment", patterns: ["부대설비명", "부대설비"] },
    { field: "equipmentCount", patterns: ["설비개수"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const managementNumber = getCell(row, colMap.managementNumber);
    
    // 관리번호가 I-로 시작해야 유효한 행
    if (!managementNumber || !managementNumber.match(/^I-/i)) {
      continue;
    }

    const capacityStr = getCell(row, colMap.capacity);
    const unitStr = getCell(row, colMap.unit);

    const emission: ParsedProcessEmission = {
      id: randomUUID(),
      managementNumber: managementNumber,
      name: getCell(row, colMap.name) || "",
      capacity: extractNumber(capacityStr),
      capacityUnit: unitStr || extractUnit(capacityStr),
      quantity: extractNumber(getCell(row, colMap.quantity)) || 1,
      operatingPressure: extractNumber(getCell(row, colMap.operatingPressure)),
      operatingTemperature: extractNumber(getCell(row, colMap.operatingTemperature)),
      dailyOperatingHours: extractNumber(getCell(row, colMap.dailyOperatingHours)),
      annualOperatingDays: extractNumber(getCell(row, colMap.annualOperatingDays)),
      upstreamFacility: getCell(row, colMap.upstreamFacility) || "",
      downstreamFacility: getCell(row, colMap.downstreamFacility) || "",
      siteArea: extractNumber(getCell(row, colMap.siteArea)),
      installationLocation: getCell(row, colMap.installationLocation) || "",
      facilityMaterial: getCell(row, colMap.facilityMaterial) || "",
      thickness: extractNumber(getCell(row, colMap.thickness)),
      auxiliaryEquipment: getCell(row, colMap.auxiliaryEquipment) || "",
      equipmentCount: extractNumber(getCell(row, colMap.equipmentCount)),
      pollutantInfo: [],
    };

    emissions.push(emission);
  }

  return emissions;
}

/**
 * 공정 트리 구조 생성
 */
export interface ProcessTreeNode {
  id: string;
  type: "major" | "unit" | "facility";
  code: string;
  name: string;
  children: ProcessTreeNode[];
  data?: ParsedMajorProcess | ParsedUnitProcess | ParsedProcessEmission;
}

export function buildProcessTree(
  majorProcesses: ParsedMajorProcess[],
  unitProcesses: ParsedUnitProcess[],
  processEmissions: ParsedProcessEmission[]
): ProcessTreeNode[] {
  const tree: ProcessTreeNode[] = [];

  // 대분류 공정별로 그룹화
  for (const major of majorProcesses) {
    const majorNode: ProcessTreeNode = {
      id: major.id,
      type: "major",
      code: major.processNumber,
      name: major.name,
      children: [],
      data: major,
    };

    // 해당 대분류에 속하는 단위공정 찾기
    const relatedUnits = unitProcesses.filter(
      u => u.majorProcessCode === major.processCode || 
           u.processCode.startsWith(major.processNumber)
    );

    for (const unit of relatedUnits) {
      const unitNode: ProcessTreeNode = {
        id: unit.id,
        type: "unit",
        code: unit.processCode,
        name: unit.facilityName || unit.description.substring(0, 30),
        children: [],
        data: unit,
      };

      // 해당 단위공정에 속하는 배출시설 찾기
      if (unit.managementNumberRange) {
        const rangeMatch = unit.managementNumberRange.match(/([IC]-[A-Z\d]+)/gi);
        if (rangeMatch) {
          const relatedEmissions = processEmissions.filter(e =>
            rangeMatch.some(r => e.managementNumber.includes(r.replace(/\d+$/, "")))
          );

          for (const emission of relatedEmissions) {
            unitNode.children.push({
              id: emission.id,
              type: "facility",
              code: emission.managementNumber,
              name: emission.name,
              children: [],
              data: emission,
            });
          }
        }
      }

      majorNode.children.push(unitNode);
    }

    tree.push(majorNode);
  }

  return tree;
}

// ============================================================================
// 사용물질 데이터 파싱
// ============================================================================

/** 물질수지 데이터 */
export interface ParsedMaterialBalance {
  id: string;
  category: string;           // 구분 (투입물/산출물)
  subCategory: string;        // 세부구분 (연료, 원료 등)
  materialName: string;       // 물질명
  unit: string;               // 단위
  processBValues: { processCode: string; value?: number }[];  // 공정별 값
  balance?: number;           // 물질수지
}

/** 연료 데이터 */
export interface ParsedFuel {
  id: string;
  number: number;
  category: string;           // 구분 (주연료 등)
  name: string;               // 연료명
  storageLocation: string;    // 보관장소
  usage: string;              // 용도
  state: string;              // 성상
  compositionData: string;    // 성분자료
  sulfurContent?: number;     // 황함량 (%)
  ashContent?: number;        // 회분함량 (%)
  heatingValue?: number;      // 발열량 (LHV)
  heatingValueUnit: string;   // 발열량 단위
  inputFacility: string;      // 투입시설
  maxUsage: {
    unit: string;
    daily?: number;
    monthly?: number;
    yearly?: number;
  };
  notes: string;
}

/** 원료/부원료 데이터 */
export interface ParsedRawMaterial {
  id: string;
  number: number;
  category: string;           // 구분 (주원료/부원료)
  name: string;               // 물질명
  storageLocation: string;    // 보관장소
  inputMethod: string;        // 투입방식
  usage: string;              // 용도
  state: string;              // 성상
  compositionData: string;    // 성분자료
  inputFacility: string;      // 투입시설
  maxUsage: {
    unit: string;
    daily?: number;
    monthly?: number;
    yearly?: number;
  };
  notes: string;
}

/** 공기 데이터 */
export interface ParsedAir {
  id: string;
  number: number;
  category: string;           // 구분
  hasTreatmentFacility: boolean;  // 처리시설 유무
  treatmentFacilityNumber: string; // 처리시설 번호
  inputFacility: string;      // 투입시설
  inputMethod: string;        // 투입방식
  usage: string;              // 용도
  maxUsage: {
    daily?: number;
    monthly?: number;
    yearly?: number;
  };
  inputOxygenContent?: number; // 투입물함유산소
  reuseAmount?: number;       // 재이용량 (Nm³/일)
  reuseFacility: string;      // 재이용시설
  reuseUsage: string;         // 재이용용도
  notes: string;
}

/** 기타 화학물질 데이터 */
export interface ParsedChemical {
  id: string;
  number: number;
  category: string;           // 구분
  name: string;               // 물질명
  storageFacility: string;    // 저장시설
  inputFacility: string;      // 투입시설
  inputMethod: string;        // 투입방식
  usage: string;              // 용도
  state: string;              // 성상
  hazard: string;             // 유해성
  compositionData: string;    // 성분자료
  maxUsage: {
    daily?: number;
    monthly?: number;
    yearly?: number;
  };
  reuseAmount?: number;       // 재이용량 (톤/일)
  reuseFacility: string;      // 재이용시설
  reuseUsage: string;         // 재이용용도
  notes: string;
}

/** 에너지 데이터 */
export interface ParsedEnergy {
  id: string;
  number: number;
  name: string;               // 물질명 (전기, 증기 등)
  supplyType: string;         // 수급구분 (내부/외부)
  supplyFacility: string;     // 수급시설
  usageLocation: string;      // 사용처
  usageUnit: string;          // 사용량 단위
  maxUsageDaily?: number;     // 1일 최대
  maxUsageYearly?: number;    // 연간 최대
  notes: string;
}

/**
 * 연료 표 파싱
 */
export function parseFuelTable(table: ExtractedTable): ParsedFuel[] {
  const fuels: ParsedFuel[] = [];

  if (!table.rows || table.rows.length < 2) {
    return fuels;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(3, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("연료명") || h.includes("발열량"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "number", patterns: ["번호"] },
    { field: "category", patterns: ["구분"] },
    { field: "name", patterns: ["연료명"] },
    { field: "storageLocation", patterns: ["보관장소"] },
    { field: "usage", patterns: ["용도"] },
    { field: "state", patterns: ["성상"] },
    { field: "compositionData", patterns: ["성분자료"] },
    { field: "sulfurContent", patterns: ["황함량"] },
    { field: "ashContent", patterns: ["회분함량"] },
    { field: "heatingValue", patterns: ["발열량"] },
    { field: "inputFacility", patterns: ["투입시설"] },
    { field: "maxUsageUnit", patterns: ["단위"] },
    { field: "maxUsageDaily", patterns: ["일", "일최대"] },
    { field: "maxUsageMonthly", patterns: ["월", "월최대"] },
    { field: "maxUsageYearly", patterns: ["년", "연최대", "연간"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const name = getCell(row, colMap.name);
    if (!name || isEmptyCell(name)) {
      continue;
    }

    const heatingValueStr = getCell(row, colMap.heatingValue);

    const fuel: ParsedFuel = {
      id: randomUUID(),
      number: extractNumber(getCell(row, colMap.number)) || fuels.length + 1,
      category: getCell(row, colMap.category) || "",
      name: name,
      storageLocation: getCell(row, colMap.storageLocation) || "",
      usage: getCell(row, colMap.usage) || "",
      state: getCell(row, colMap.state) || "",
      compositionData: getCell(row, colMap.compositionData) || "",
      sulfurContent: extractNumber(getCell(row, colMap.sulfurContent)),
      ashContent: extractNumber(getCell(row, colMap.ashContent)),
      heatingValue: extractNumber(heatingValueStr),
      heatingValueUnit: extractUnit(heatingValueStr),
      inputFacility: getCell(row, colMap.inputFacility) || "",
      maxUsage: {
        unit: getCell(row, colMap.maxUsageUnit) || "",
        daily: extractNumber(getCell(row, colMap.maxUsageDaily)),
        monthly: extractNumber(getCell(row, colMap.maxUsageMonthly)),
        yearly: extractNumber(getCell(row, colMap.maxUsageYearly)),
      },
      notes: getCell(row, colMap.notes) || "",
    };

    fuels.push(fuel);
  }

  return fuels;
}

/**
 * 원료/부원료 표 파싱
 */
export function parseRawMaterialTable(table: ExtractedTable): ParsedRawMaterial[] {
  const materials: ParsedRawMaterial[] = [];

  if (!table.rows || table.rows.length < 2) {
    return materials;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(3, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("물질명") || h.includes("원료"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "number", patterns: ["번호"] },
    { field: "category", patterns: ["구분"] },
    { field: "name", patterns: ["물질명"] },
    { field: "storageLocation", patterns: ["보관장소"] },
    { field: "inputMethod", patterns: ["투입방식"] },
    { field: "usage", patterns: ["용도"] },
    { field: "state", patterns: ["성상"] },
    { field: "compositionData", patterns: ["성분자료"] },
    { field: "inputFacility", patterns: ["투입시설"] },
    { field: "maxUsageUnit", patterns: ["단위"] },
    { field: "maxUsageDaily", patterns: ["일"] },
    { field: "maxUsageMonthly", patterns: ["월"] },
    { field: "maxUsageYearly", patterns: ["년", "연간"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const name = getCell(row, colMap.name);
    if (!name || isEmptyCell(name)) {
      continue;
    }

    const material: ParsedRawMaterial = {
      id: randomUUID(),
      number: extractNumber(getCell(row, colMap.number)) || materials.length + 1,
      category: getCell(row, colMap.category) || "",
      name: name,
      storageLocation: getCell(row, colMap.storageLocation) || "",
      inputMethod: getCell(row, colMap.inputMethod) || "",
      usage: getCell(row, colMap.usage) || "",
      state: getCell(row, colMap.state) || "",
      compositionData: getCell(row, colMap.compositionData) || "",
      inputFacility: getCell(row, colMap.inputFacility) || "",
      maxUsage: {
        unit: getCell(row, colMap.maxUsageUnit) || "",
        daily: extractNumber(getCell(row, colMap.maxUsageDaily)),
        monthly: extractNumber(getCell(row, colMap.maxUsageMonthly)),
        yearly: extractNumber(getCell(row, colMap.maxUsageYearly)),
      },
      notes: getCell(row, colMap.notes) || "",
    };

    materials.push(material);
  }

  return materials;
}

/**
 * 기타 화학물질 표 파싱
 */
export function parseChemicalTable(table: ExtractedTable): ParsedChemical[] {
  const chemicals: ParsedChemical[] = [];

  if (!table.rows || table.rows.length < 2) {
    return chemicals;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(3, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("유해성") || h.includes("화학물질"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "number", patterns: ["번호"] },
    { field: "category", patterns: ["구분"] },
    { field: "name", patterns: ["물질명"] },
    { field: "storageFacility", patterns: ["저장시설"] },
    { field: "inputFacility", patterns: ["투입시설"] },
    { field: "inputMethod", patterns: ["투입방식"] },
    { field: "usage", patterns: ["용도"] },
    { field: "state", patterns: ["성상"] },
    { field: "hazard", patterns: ["유해성"] },
    { field: "compositionData", patterns: ["성분자료"] },
    { field: "maxUsageDaily", patterns: ["일"] },
    { field: "maxUsageMonthly", patterns: ["월"] },
    { field: "maxUsageYearly", patterns: ["년", "연간"] },
    { field: "reuseAmount", patterns: ["재이용량"] },
    { field: "reuseFacility", patterns: ["재이용시설"] },
    { field: "reuseUsage", patterns: ["재이용용도"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const name = getCell(row, colMap.name);
    if (!name || isEmptyCell(name)) {
      continue;
    }

    const chemical: ParsedChemical = {
      id: randomUUID(),
      number: extractNumber(getCell(row, colMap.number)) || chemicals.length + 1,
      category: getCell(row, colMap.category) || "",
      name: name,
      storageFacility: getCell(row, colMap.storageFacility) || "",
      inputFacility: getCell(row, colMap.inputFacility) || "",
      inputMethod: getCell(row, colMap.inputMethod) || "",
      usage: getCell(row, colMap.usage) || "",
      state: getCell(row, colMap.state) || "",
      hazard: getCell(row, colMap.hazard) || "",
      compositionData: getCell(row, colMap.compositionData) || "",
      maxUsage: {
        daily: extractNumber(getCell(row, colMap.maxUsageDaily)),
        monthly: extractNumber(getCell(row, colMap.maxUsageMonthly)),
        yearly: extractNumber(getCell(row, colMap.maxUsageYearly)),
      },
      reuseAmount: extractNumber(getCell(row, colMap.reuseAmount)),
      reuseFacility: getCell(row, colMap.reuseFacility) || "",
      reuseUsage: getCell(row, colMap.reuseUsage) || "",
      notes: getCell(row, colMap.notes) || "",
    };

    chemicals.push(chemical);
  }

  return chemicals;
}

/**
 * 에너지 표 파싱
 */
export function parseEnergyTable(table: ExtractedTable): ParsedEnergy[] {
  const energies: ParsedEnergy[] = [];

  if (!table.rows || table.rows.length < 2) {
    return energies;
  }

  // 헤더 행 찾기
  let headerRowIndex = 0;
  let headers: string[] = [];

  for (let i = 0; i < Math.min(3, table.rows.length); i++) {
    const row = table.rows[i];
    const normalizedRow = row.map(h => normalizeHeader(h));
    if (normalizedRow.some(h => h.includes("수급구분") || h.includes("사용처"))) {
      headerRowIndex = i;
      headers = normalizedRow;
      break;
    }
  }

  if (headers.length === 0) {
    headers = table.rows[0].map(h => normalizeHeader(h));
  }

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "number", patterns: ["번호"] },
    { field: "name", patterns: ["물질명"] },
    { field: "supplyType", patterns: ["수급구분"] },
    { field: "supplyFacility", patterns: ["수급시설"] },
    { field: "usageLocation", patterns: ["사용처"] },
    { field: "usageUnit", patterns: ["단위"] },
    { field: "maxUsageDaily", patterns: ["1일최대", "일최대", "일"] },
    { field: "maxUsageYearly", patterns: ["연간최대", "연최대", "년", "연간"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 데이터 행 파싱
  for (let i = headerRowIndex + 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const name = getCell(row, colMap.name);
    if (!name || isEmptyCell(name)) {
      continue;
    }

    const energy: ParsedEnergy = {
      id: randomUUID(),
      number: extractNumber(getCell(row, colMap.number)) || energies.length + 1,
      name: name,
      supplyType: getCell(row, colMap.supplyType) || "",
      supplyFacility: getCell(row, colMap.supplyFacility) || "",
      usageLocation: getCell(row, colMap.usageLocation) || "",
      usageUnit: getCell(row, colMap.usageUnit) || "",
      maxUsageDaily: extractNumber(getCell(row, colMap.maxUsageDaily)),
      maxUsageYearly: extractNumber(getCell(row, colMap.maxUsageYearly)),
      notes: getCell(row, colMap.notes) || "",
    };

    energies.push(energy);
  }

  return energies;
}

// ============================================================================
// 오염물질 배출량 데이터 파싱
// ============================================================================

/** 오염물질 배출량 데이터 (공통) */
export interface ParsedPollutantEmission {
  id: string;
  outletNumber: string;       // 배출구/방류구 번호 또는 시설명
  pollutantName: string;      // 오염물질명
  unit: string;               // 단위
  yearlyData: { year: number; value?: number }[];  // 연도별 데이터
  max?: number;               // 최대
  min?: number;               // 최소
  avg?: number;               // 평균
  notes: string;              // 비고
  type: "air" | "water" | "soil" | "waste";  // 유형
}

/**
 * 대기오염물질 배출량 표 파싱
 */
export function parseAirPollutantTable(table: ExtractedTable): ParsedPollutantEmission[] {
  const emissions: ParsedPollutantEmission[] = [];

  if (!table.rows || table.rows.length < 2) {
    return emissions;
  }

  // 헤더 행 분석 (연도 열 동적 추출)
  const headerRow = table.rows[0];
  const yearColumns: { index: number; year: number }[] = [];
  
  // 연도 열 찾기 (2019, 2020, ... 등)
  headerRow.forEach((cell, idx) => {
    const yearMatch = cell.match(/20\d{2}/);
    if (yearMatch) {
      yearColumns.push({ index: idx, year: parseInt(yearMatch[0]) });
    }
  });

  // 헤더 정규화
  const headers = headerRow.map(h => normalizeHeader(h));

  // 열 인덱스 매핑
  const colMap = buildColumnMap(headers, [
    { field: "outletNumber", patterns: ["굴뚝", "배출구", "#a"] },
    { field: "pollutantName", patterns: ["오염물질", "물질명"] },
    { field: "unit", patterns: ["단위"] },
    { field: "max", patterns: ["최대"] },
    { field: "min", patterns: ["최소"] },
    { field: "avg", patterns: ["평균"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  // 현재 배출구 번호 (행 병합 대응)
  let currentOutlet = "";

  // 데이터 행 파싱
  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    // 배출구 번호 업데이트
    const outletCell = getCell(row, colMap.outletNumber);
    if (outletCell && !isEmptyCell(outletCell) && outletCell.match(/#[A-Z]-?\d*/i)) {
      currentOutlet = outletCell.trim();
    }

    const pollutantName = getCell(row, colMap.pollutantName);
    if (!pollutantName || isEmptyCell(pollutantName)) {
      continue;
    }

    // 연도별 데이터 추출
    const yearlyData = yearColumns.map(({ index, year }) => ({
      year,
      value: extractNumber(row[index]),
    }));

    const emission: ParsedPollutantEmission = {
      id: randomUUID(),
      outletNumber: currentOutlet,
      pollutantName: pollutantName,
      unit: getCell(row, colMap.unit) || "",
      yearlyData,
      max: extractNumber(getCell(row, colMap.max)),
      min: extractNumber(getCell(row, colMap.min)),
      avg: extractNumber(getCell(row, colMap.avg)),
      notes: getCell(row, colMap.notes) || "",
      type: "air",
    };

    emissions.push(emission);
  }

  return emissions;
}

/**
 * 수질오염물질 배출량 표 파싱
 */
export function parseWaterPollutantTable(table: ExtractedTable): ParsedPollutantEmission[] {
  const emissions: ParsedPollutantEmission[] = [];

  if (!table.rows || table.rows.length < 2) {
    return emissions;
  }

  // 헤더 행 분석
  const headerRow = table.rows[0];
  const yearColumns: { index: number; year: number }[] = [];
  
  headerRow.forEach((cell, idx) => {
    const yearMatch = cell.match(/20\d{2}/);
    if (yearMatch) {
      yearColumns.push({ index: idx, year: parseInt(yearMatch[0]) });
    }
  });

  const headers = headerRow.map(h => normalizeHeader(h));

  // 방류구 열 존재 여부 확인
  const hasOutletColumn = headers.some(h => h.includes("방류구") || h.includes("#w"));

  const colMap = buildColumnMap(headers, [
    { field: "outletNumber", patterns: ["방류구", "#w"] },
    { field: "pollutantName", patterns: ["오염물질", "물질명"] },
    { field: "unit", patterns: ["단위"] },
    { field: "max", patterns: ["최대"] },
    { field: "min", patterns: ["최소"] },
    { field: "avg", patterns: ["평균"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  let currentOutlet = hasOutletColumn ? "" : "#W-1";  // 방류구 열 없으면 기본값

  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    if (hasOutletColumn) {
      const outletCell = getCell(row, colMap.outletNumber);
      if (outletCell && !isEmptyCell(outletCell)) {
        currentOutlet = outletCell.trim();
      }
    }

    const pollutantName = getCell(row, colMap.pollutantName);
    if (!pollutantName || isEmptyCell(pollutantName)) {
      continue;
    }

    const yearlyData = yearColumns.map(({ index, year }) => ({
      year,
      value: extractNumber(row[index]),
    }));

    const emission: ParsedPollutantEmission = {
      id: randomUUID(),
      outletNumber: currentOutlet,
      pollutantName: pollutantName,
      unit: getCell(row, colMap.unit) || "",
      yearlyData,
      max: extractNumber(getCell(row, colMap.max)),
      min: extractNumber(getCell(row, colMap.min)),
      avg: extractNumber(getCell(row, colMap.avg)),
      notes: getCell(row, colMap.notes) || "",
      type: "water",
    };

    emissions.push(emission);
  }

  return emissions;
}

/**
 * 토양오염물질 표 파싱
 */
export function parseSoilPollutantTable(table: ExtractedTable): ParsedPollutantEmission[] {
  const emissions: ParsedPollutantEmission[] = [];

  if (!table.rows || table.rows.length < 2) {
    return emissions;
  }

  const headerRow = table.rows[0];
  const yearColumns: { index: number; year: number }[] = [];
  
  headerRow.forEach((cell, idx) => {
    const yearMatch = cell.match(/20\d{2}/);
    if (yearMatch) {
      yearColumns.push({ index: idx, year: parseInt(yearMatch[0]) });
    }
  });

  const headers = headerRow.map(h => normalizeHeader(h));

  const colMap = buildColumnMap(headers, [
    { field: "facilityName", patterns: ["시설명"] },
    { field: "sampleType", patterns: ["시료구분"] },
    { field: "pollutantName", patterns: ["오염물질"] },
    { field: "unit", patterns: ["단위"] },
    { field: "max", patterns: ["최대"] },
    { field: "min", patterns: ["최소"] },
    { field: "avg", patterns: ["평균"] },
    { field: "notes", patterns: ["비고"] },
  ]);

  let currentFacility = "";

  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const facilityCell = getCell(row, colMap.facilityName);
    if (facilityCell && !isEmptyCell(facilityCell)) {
      currentFacility = facilityCell.trim();
    }

    const pollutantName = getCell(row, colMap.pollutantName);
    if (!pollutantName || isEmptyCell(pollutantName)) {
      continue;
    }

    const sampleType = getCell(row, colMap.sampleType);
    const yearlyData = yearColumns.map(({ index, year }) => ({
      year,
      value: extractNumber(row[index]),
    }));

    const emission: ParsedPollutantEmission = {
      id: randomUUID(),
      outletNumber: `${currentFacility} (${sampleType || ""})`.trim(),
      pollutantName: pollutantName,
      unit: getCell(row, colMap.unit) || "",
      yearlyData,
      max: extractNumber(getCell(row, colMap.max)),
      min: extractNumber(getCell(row, colMap.min)),
      avg: extractNumber(getCell(row, colMap.avg)),
      notes: getCell(row, colMap.notes) || "",
      type: "soil",
    };

    emissions.push(emission);
  }

  return emissions;
}

/**
 * 폐기물 배출량 표 파싱
 */
export function parseWastePollutantTable(table: ExtractedTable): ParsedPollutantEmission[] {
  const emissions: ParsedPollutantEmission[] = [];

  if (!table.rows || table.rows.length < 2) {
    return emissions;
  }

  const headerRow = table.rows[0];
  const yearColumns: { index: number; year: number }[] = [];
  
  headerRow.forEach((cell, idx) => {
    const yearMatch = cell.match(/20\d{2}/);
    if (yearMatch) {
      yearColumns.push({ index: idx, year: parseInt(yearMatch[0]) });
    }
  });

  const headers = headerRow.map(h => normalizeHeader(h));

  // 분류코드가 첫 번째인지 폐기물명이 첫 번째인지 판별
  const hasCodeFirst = headers[0]?.includes("분류코드") || headers[0]?.includes("코드");

  const colMap = buildColumnMap(headers, [
    { field: "wasteCode", patterns: ["분류코드", "코드"] },
    { field: "wasteName", patterns: ["폐기물명", "폐기물"] },
    { field: "unit", patterns: ["단위"] },
    { field: "max", patterns: ["최대"] },
    { field: "min", patterns: ["최소"] },
    { field: "avg", patterns: ["평균"] },
    { field: "notes", patterns: ["비고"] },
    { field: "wasteType", patterns: ["구분", "일반", "지정"] },
  ]);

  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    
    const wasteName = getCell(row, colMap.wasteName);
    const wasteCode = getCell(row, colMap.wasteCode);
    
    // 폐기물명 또는 분류코드가 있어야 함
    if ((!wasteName || isEmptyCell(wasteName)) && (!wasteCode || isEmptyCell(wasteCode))) {
      continue;
    }

    const yearlyData = yearColumns.map(({ index, year }) => ({
      year,
      value: extractNumber(row[index]),
    }));

    const wasteType = getCell(row, colMap.wasteType);
    const outletNumber = wasteCode ? `[${wasteCode}] ${wasteName || ""}` : wasteName || "";

    const emission: ParsedPollutantEmission = {
      id: randomUUID(),
      outletNumber: outletNumber.trim(),
      pollutantName: wasteType ? `${wasteType} 폐기물` : "폐기물",
      unit: getCell(row, colMap.unit) || "",
      yearlyData,
      max: extractNumber(getCell(row, colMap.max)),
      min: extractNumber(getCell(row, colMap.min)),
      avg: extractNumber(getCell(row, colMap.avg)),
      notes: getCell(row, colMap.notes) || "",
      type: "waste",
    };

    emissions.push(emission);
  }

  return emissions;
}

// ============================================================================
// 허가 탭 데이터 파싱
// ============================================================================

/** 허가 추진경과 이벤트 */
export interface ParsedPermitEvent {
  id: string;
  date: string;               // 날짜 (YYYY.MM.DD)
  description: string;        // 설명
}

/** 허가 발생량 변경 */
export interface ParsedPermitEmissionChange {
  id: string;
  category: string;           // 구분 (증가/감소/변경 후 등)
  pollutantValues: { name: string; value?: number }[];  // 오염물질별 값
}

/**
 * 허가 추진경과 이벤트 표 파싱
 */
export function parsePermitEventTable(table: ExtractedTable): ParsedPermitEvent[] {
  const events: ParsedPermitEvent[] = [];

  if (!table.rows || table.rows.length === 0) {
    return events;
  }

  const datePattern = /(\d{4}\.\d{2}\.\d{2})/;

  for (const row of table.rows) {
    const rowText = row.join(" ");
    const dateMatch = rowText.match(datePattern);
    
    if (dateMatch) {
      const date = dateMatch[1];
      // 날짜 이후의 텍스트를 설명으로 추출
      const descriptionStart = rowText.indexOf(date) + date.length;
      let description = rowText.substring(descriptionStart).trim();
      
      // ○ 마커 제거
      description = description.replace(/^[○●■□▪▫]\s*/, "");

      if (description) {
        events.push({
          id: randomUUID(),
          date,
          description,
        });
      }
    }
  }

  return events;
}

/**
 * 허가 발생량 변경 표 파싱
 */
export function parsePermitEmissionChangeTable(table: ExtractedTable): ParsedPermitEmissionChange[] {
  const changes: ParsedPermitEmissionChange[] = [];

  if (!table.rows || table.rows.length < 2) {
    return changes;
  }

  // 헤더에서 오염물질명 추출
  const headerRow = table.rows[0];
  const pollutantColumns: { index: number; name: string }[] = [];
  
  const pollutantNames = ["먼지", "황산화물", "질소산화물", "SOx", "NOx", "계", "합계"];
  
  headerRow.forEach((cell, idx) => {
    if (idx > 0) {  // 첫 번째 열(구분)은 제외
      for (const name of pollutantNames) {
        if (cell.includes(name)) {
          pollutantColumns.push({ index: idx, name: cell.trim() });
          break;
        }
      }
    }
  });

  // 데이터 행 파싱
  for (let i = 1; i < table.rows.length; i++) {
    const row = table.rows[i];
    const category = row[0]?.trim();
    
    if (!category || isEmptyCell(category)) {
      continue;
    }

    const pollutantValues = pollutantColumns.map(({ index, name }) => ({
      name,
      value: extractNumber(row[index]),
    }));

    changes.push({
      id: randomUUID(),
      category,
      pollutantValues,
    });
  }

  return changes;
}

// ============================================================================
// 총괄표 자동 생성
// ============================================================================

/** 시설 총괄표 데이터 */
export interface FacilitySummary {
  processCategory: string;    // 공정분류
  processNumber: string;      // 공정번호
  totalFacilities: number;    // 총 시설
  nonTargetFacilities: number; // 비대상시설
  emissionFacilities: {
    total: number;
    air: number;
    water: number;
    waste: number;
  };
  preventionFacilities: {
    total: number;
    air: number;
    water: number;
  };
}

/**
 * 배출시설/방지시설 데이터로 총괄표 자동 생성
 */
export function generateFacilitySummary(
  emissionFacilities: ParsedEmissionFacility[],
  nonEmissionFacilities: ParsedEmissionFacility[],
  preventionFacilities: ParsedPreventionFacility[]
): FacilitySummary[] {
  // 공정번호별로 그룹화
  const processMap = new Map<string, FacilitySummary>();

  // 배출시설 집계
  for (const facility of emissionFacilities) {
    const processNumber = facility.processNumber || "기타";
    
    if (!processMap.has(processNumber)) {
      processMap.set(processNumber, {
        processCategory: processNumber.split("-")[0] || "",
        processNumber,
        totalFacilities: 0,
        nonTargetFacilities: 0,
        emissionFacilities: { total: 0, air: 0, water: 0, waste: 0 },
        preventionFacilities: { total: 0, air: 0, water: 0 },
      });
    }

    const summary = processMap.get(processNumber)!;
    summary.totalFacilities++;
    summary.emissionFacilities.total++;
    
    switch (facility.emissionMedia) {
      case "air":
      case "odor":
        summary.emissionFacilities.air++;
        break;
      case "water":
        summary.emissionFacilities.water++;
        break;
      case "waste":
        summary.emissionFacilities.waste++;
        break;
    }
  }

  // 비배출시설 집계
  for (const facility of nonEmissionFacilities) {
    const processNumber = facility.processNumber || "기타";
    
    if (!processMap.has(processNumber)) {
      processMap.set(processNumber, {
        processCategory: processNumber.split("-")[0] || "",
        processNumber,
        totalFacilities: 0,
        nonTargetFacilities: 0,
        emissionFacilities: { total: 0, air: 0, water: 0, waste: 0 },
        preventionFacilities: { total: 0, air: 0, water: 0 },
      });
    }

    const summary = processMap.get(processNumber)!;
    summary.totalFacilities++;
    summary.nonTargetFacilities++;
  }

  // 방지시설 집계
  for (const facility of preventionFacilities) {
    const processNumber = facility.processNumber || "기타";
    
    if (!processMap.has(processNumber)) {
      processMap.set(processNumber, {
        processCategory: processNumber.split("-")[0] || "",
        processNumber,
        totalFacilities: 0,
        nonTargetFacilities: 0,
        emissionFacilities: { total: 0, air: 0, water: 0, waste: 0 },
        preventionFacilities: { total: 0, air: 0, water: 0 },
      });
    }

    const summary = processMap.get(processNumber)!;
    summary.preventionFacilities.total++;
    
    // 방지시설 매체 구분 (시설번호 또는 처리오염물질로 판단)
    const facilityNum = facility.facilityNumber || "";
    const pollutants = facility.pollutants.join(" ");
    
    if (facilityNum.match(/^[AC]-/i) || pollutants.match(/대기|먼지|황산화물|질소산화물|SOx|NOx/i)) {
      summary.preventionFacilities.air++;
    } else if (facilityNum.match(/^W-/i) || pollutants.match(/수질|BOD|COD|SS/i)) {
      summary.preventionFacilities.water++;
    } else {
      // 기본값: 대기
      summary.preventionFacilities.air++;
    }
  }

  // 공정번호 순으로 정렬
  return Array.from(processMap.values()).sort((a, b) => 
    a.processNumber.localeCompare(b.processNumber)
  );
}

// ============================================================================
// 문서에서 모든 표 파싱
// ============================================================================

/** 전체 파싱 결과 타입 */
export interface ParsedDocumentResult {
  // 기존 배출/방지시설
  emissionFacilities: ParsedEmissionFacility[];
  nonEmissionFacilities: ParsedEmissionFacility[];
  preventionFacilities: ParsedPreventionFacility[];
  
  // 개요 데이터
  overview: ParsedOverview | null;
  otherPermits: ParsedOtherPermits | null;
  
  // 공정 데이터
  majorProcesses: ParsedMajorProcess[];
  unitProcesses: ParsedUnitProcess[];
  processEmissions: ParsedProcessEmission[];
  
  // 사용물질 데이터
  fuels: ParsedFuel[];
  rawMaterials: ParsedRawMaterial[];
  chemicals: ParsedChemical[];
  energies: ParsedEnergy[];
  
  // 오염물질 배출량 데이터
  pollutantEmissions: {
    air: ParsedPollutantEmission[];
    water: ParsedPollutantEmission[];
    soil: ParsedPollutantEmission[];
    waste: ParsedPollutantEmission[];
  };
  
  // 허가 추진경과 데이터
  permitEvents: ParsedPermitEvent[];
  permitEmissionChanges: ParsedPermitEmissionChange[];
  
  // 총괄표
  facilitySummary: FacilitySummary[];
  
  // 표 유형 정보
  tableTypes: { index: number; type: TableType }[];
}

/**
 * 추출된 문서에서 모든 관련 표를 파싱합니다.
 */
export function parseAllTables(document: ExtractedDocument): ParsedDocumentResult {
  const result: ParsedDocumentResult = {
    emissionFacilities: [],
    nonEmissionFacilities: [],
    preventionFacilities: [],
    overview: null,
    otherPermits: null,
    majorProcesses: [],
    unitProcesses: [],
    processEmissions: [],
    fuels: [],
    rawMaterials: [],
    chemicals: [],
    energies: [],
    pollutantEmissions: {
      air: [],
      water: [],
      soil: [],
      waste: [],
    },
    permitEvents: [],
    permitEmissionChanges: [],
    facilitySummary: [],
    tableTypes: [],
  };

  // 텍스트에서 개요 데이터 파싱
  if (document.text_content) {
    result.overview = parseOverviewFromText(document.text_content);
  }

  if (!document.tables || document.tables.length === 0) {
    return result;
  }

  // 모든 표 순회하며 파싱
  for (const table of document.tables) {
    const tableType = identifyTableType(table);
    result.tableTypes.push({ index: table.table_index, type: tableType });

    switch (tableType) {
      // 배출시설/방지시설
      case "emission": {
        const { emissions, nonEmissions } = parseEmissionFacilitiesTable(table);
        result.emissionFacilities.push(...emissions);
        result.nonEmissionFacilities.push(...nonEmissions);
        break;
      }
      case "prevention": {
        const preventions = parsePreventionFacilitiesTable(table);
        result.preventionFacilities.push(...preventions);
        break;
      }

      // 개요
      case "overview": {
        const overviewData = parseOverviewTable(table);
        if (result.overview) {
          // 기존 텍스트 파싱 결과와 병합
          if (overviewData.ksicCodes && overviewData.ksicCodes.length > 0) {
            result.overview.ksicCodes = overviewData.ksicCodes;
          }
          if (overviewData.mainProducts) {
            result.overview.mainProducts = overviewData.mainProducts;
          }
          if (overviewData.permitScale) {
            if (overviewData.permitScale.air.grade) {
              result.overview.permitScale.air = overviewData.permitScale.air;
            }
            if (overviewData.permitScale.water.grade) {
              result.overview.permitScale.water = overviewData.permitScale.water;
            }
          }
        } else {
          result.overview = {
            ...overviewData,
            permitsByMedia: { air: [], water: [], waste: [], noise: [], others: [] },
          } as ParsedOverview;
        }
        break;
      }
      case "other-permit": {
        result.otherPermits = parseOtherPermitsTable(table);
        break;
      }

      // 공정
      case "process-major": {
        const processes = parseMajorProcessTable(table);
        result.majorProcesses.push(...processes);
        break;
      }
      case "process-unit": {
        const processes = parseUnitProcessTable(table);
        result.unitProcesses.push(...processes);
        break;
      }
      case "process-emission": {
        const emissions = parseProcessEmissionTable(table);
        result.processEmissions.push(...emissions);
        break;
      }

      // 사용물질
      case "substance-fuel": {
        const fuels = parseFuelTable(table);
        result.fuels.push(...fuels);
        break;
      }
      case "substance-raw": {
        const materials = parseRawMaterialTable(table);
        result.rawMaterials.push(...materials);
        break;
      }
      case "substance-chemical": {
        const chemicals = parseChemicalTable(table);
        result.chemicals.push(...chemicals);
        break;
      }
      case "substance-energy": {
        const energies = parseEnergyTable(table);
        result.energies.push(...energies);
        break;
      }

      // 오염물질 배출량
      case "pollutant-air": {
        const emissions = parseAirPollutantTable(table);
        result.pollutantEmissions.air.push(...emissions);
        break;
      }
      case "pollutant-water": {
        const emissions = parseWaterPollutantTable(table);
        result.pollutantEmissions.water.push(...emissions);
        break;
      }
      case "pollutant-soil": {
        const emissions = parseSoilPollutantTable(table);
        result.pollutantEmissions.soil.push(...emissions);
        break;
      }
      case "pollutant-waste": {
        const emissions = parseWastePollutantTable(table);
        result.pollutantEmissions.waste.push(...emissions);
        break;
      }

      // 허가 추진경과
      case "permit-event": {
        const events = parsePermitEventTable(table);
        result.permitEvents.push(...events);
        break;
      }
      case "permit-emission-change": {
        const changes = parsePermitEmissionChangeTable(table);
        result.permitEmissionChanges.push(...changes);
        break;
      }

      default:
        break;
    }
  }

  // 총괄표 자동 생성
  result.facilitySummary = generateFacilitySummary(
    result.emissionFacilities,
    result.nonEmissionFacilities,
    result.preventionFacilities
  );

  return result;
}
