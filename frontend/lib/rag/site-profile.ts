/**
 * 사업장 프로파일 스키마 및 스토어
 * 
 * 통합환경관리계획서 기반 사업장별 맞춤형 RAG 분석을 위한 프로파일 관리
 * 21개 통합허가 대상업종 지원
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// ============================================================================
// 21개 통합허가 대상업종 정의
// ============================================================================

/** 통합허가 대상업종 ID */
export type IndustryCategory =
  | "power"          // 발전업
  | "steam"          // 증기/냉온수
  | "waste"          // 폐기물
  | "petrochemical"  // 석유화학
  | "rubber"         // 고무
  | "steel"          // 철강
  | "nonferrous"     // 비철
  | "refinery"       // 석유정제/비료
  | "inorganic"      // 무기/유기화학
  | "otherchemical"  // 기타화학
  | "pulp"           // 종이/펄프
  | "electronics"    // 전자부품
  | "meat"           // 도축/육가공
  | "alcohol"        // 알콜음료
  | "textile"        // 섬유/염색
  | "plastic"        // 플라스틱
  | "semiconductor"  // 반도체
  | "autoparts"      // 자동차부품
  | "cement"         // 시멘트
  | "battery"        // 2차전지
  | "other";         // 기타

/** 업종 정보 */
export interface IndustryCategoryInfo {
  id: IndustryCategory;
  label: string;
  code: string;
  icon: string;
  description?: string;
  applicableYear?: number;  // 통합허가 적용 시작년도
}

/** 21개 통합허가 대상업종 목록 */
export const INDUSTRY_CATEGORIES: IndustryCategoryInfo[] = [
  { id: "power", label: "발전업", code: "351", icon: "Zap", applicableYear: 2017 },
  { id: "steam", label: "증기/냉온수", code: "353", icon: "Thermometer", applicableYear: 2017 },
  { id: "waste", label: "폐기물", code: "382", icon: "Trash2", applicableYear: 2017 },
  { id: "petrochemical", label: "석유화학", code: "20111", icon: "Droplet", applicableYear: 2018 },
  { id: "rubber", label: "고무", code: "203", icon: "Circle", applicableYear: 2018 },
  { id: "steel", label: "철강", code: "241", icon: "Hammer", applicableYear: 2018 },
  { id: "nonferrous", label: "비철", code: "242", icon: "Hexagon", applicableYear: 2018 },
  { id: "refinery", label: "석유정제/비료", code: "192,202", icon: "Fuel", applicableYear: 2019 },
  { id: "inorganic", label: "무기/유기화학", code: "201", icon: "FlaskConical", applicableYear: 2019 },
  { id: "otherchemical", label: "기타화학", code: "204", icon: "Beaker", applicableYear: 2019 },
  { id: "pulp", label: "종이/펄프", code: "171,179", icon: "FileText", applicableYear: 2020 },
  { id: "electronics", label: "전자부품", code: "262", icon: "Cpu", applicableYear: 2020 },
  { id: "meat", label: "도축/육가공", code: "101", icon: "Beef", applicableYear: 2021 },
  { id: "alcohol", label: "알콜음료", code: "111", icon: "Wine", applicableYear: 2021 },
  { id: "textile", label: "섬유/염색", code: "134", icon: "Shirt", applicableYear: 2021 },
  { id: "plastic", label: "플라스틱", code: "222", icon: "Package", applicableYear: 2021 },
  { id: "semiconductor", label: "반도체", code: "261", icon: "Microchip", applicableYear: 2021 },
  { id: "autoparts", label: "자동차부품", code: "303", icon: "Car", applicableYear: 2021 },
  { id: "cement", label: "시멘트", code: "2394", icon: "Building", applicableYear: 2022 },
  { id: "battery", label: "2차전지", code: "2640", icon: "Battery", applicableYear: 2026, description: "전해질, 양극재/음극재 등 제조업" },
  { id: "other", label: "기타", code: "9999", icon: "MoreHorizontal" },
];

/** 업종 ID로 정보 조회 */
export const INDUSTRY_CATEGORY_MAP: Record<IndustryCategory, IndustryCategoryInfo> = 
  INDUSTRY_CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: cat }), {} as Record<IndustryCategory, IndustryCategoryInfo>);

// ============================================================================
// 사업장 규모 정의
// ============================================================================

/** 사업장 규모 */
export type FacilityScale = "small" | "medium" | "large" | "conglomerate";

export const SCALE_LABELS: Record<FacilityScale, string> = {
  small: "소규모",
  medium: "중규모",
  large: "대규모",
  conglomerate: "대기업",
};

// ============================================================================
// 탭 1: 개요 (Overview)
// ============================================================================

/** 표준산업분류코드 항목 */
export interface IndustryCodeItem {
  code: string;                    // 5자리 코드
  name: string;                    // 분류명
  fullPath?: string;               // 전체 분류 경로
}

/** 담당자 정보 */
export interface ContactInfo {
  id?: string;                     // 고유 ID (복수 담당자 구분용)
  contactType?: "contract" | "environment" | "manufacturing";  // 유형 (계약/환경/제조파트)
  department?: string;             // 부서
  position?: string;               // 직함
  name?: string;                   // 성함
  phone?: string;                  // 연락처
  email?: string;                  // 이메일
}

/** 종 규모 (대기/수질) */
export interface FacilityClass {
  airClass?: number;               // 대기 O종 (1-5)
  waterClass?: number;             // 수질 O종 (1-5)
}

/** 연간 배출량 */
export interface AnnualEmissions {
  dust?: number;                   // 먼지 (톤/년)
  sox?: number;                    // SOx (톤/년)
  nox?: number;                    // NOx (톤/년)
  wastewater?: number;             // 폐수 배출량 (㎥/년)
}

/** 면적 정보 */
export interface AreaInfo {
  factorySite?: number;            // 공장 부지 면적 (㎡)
  manufacturingFacility?: number;  // 제조시설 면적 (㎡)
  supportFacility?: number;        // 부대시설 면적 (㎡)
}

/** 기본 정보 */
export interface BasicInfo {
  name: string;                    // 사업장명
  logo?: string;                   // 사업장 CI/로고 (이미지 경로)
  corporateRegistrationNumber?: string;  // 법인등록번호 (OOOOOO-OOOOOOO 형식)
  representative?: string;         // 대표자
  businessNumber?: string;         // 사업자등록번호
  industryCategory: IndustryCategory;  // 업종 분류 (21개 통합허가 대상업종)
  industryCodes?: IndustryCodeItem[];  // 표준산업분류코드 (복수 가능)
  scale: FacilityScale;            // 규모
  employees?: number;              // 종업원 수
  annualRevenue?: number;          // 연간 매출 (억원)
  establishment?: string;          // 설립일
  location: {
    zipCode?: string;              // 우편번호
    roadAddress: string;           // 도로명 주소
    jibunAddress?: string;         // 지번 주소
    detailAddress?: string;        // 상세주소
    region: string;                // 시/도
    district: string;              // 구/군
    industrialComplex?: string;    // 산업단지명
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  mainProducts?: string[];         // 주요 생산품
  facilityClass?: FacilityClass;   // 종 규모 (대기/수질)
  annualEmissions?: AnnualEmissions;  // 연간 배출량
  area?: AreaInfo;                 // 면적 정보
  contact?: ContactInfo;           // 담당자 정보 (단일, 하위 호환)
  contacts?: ContactInfo[];        // 담당자 정보 (복수)
  
  // 하위 호환성을 위해 유지
  /** @deprecated use location.roadAddress instead */
  address?: string;
  /** @deprecated use area instead */
  siteArea?: number;
  /** @deprecated use area instead */
  buildingArea?: number;
}

/** 시설현황 요약 */
export interface FacilitySummary {
  emissionFacilityCount: number;   // 배출시설 수
  preventionFacilityCount: number; // 방지시설 수
  stackCount: number;              // 굴뚝 수 (총합)
  generalStackCount?: number;      // 일반 굴뚝 수
  cleansysStackCount?: number;     // CleanSYS 굴뚝 수
  flareStackCount?: number;        // 플레어스택 수
  dischargePointCount: number;     // 방류구 수
  processCount: number;            // 공정 수
  tmsInstalled: boolean;           // TMS 설치 여부
}

/** 매체별 인허가 사항 */
export interface MediaPermits {
  // 통합허가
  air?: string[];                  // 대기 관련 인허가
  water?: string[];                // 수질 관련 인허가
  waste?: string[];                // 폐기물 관련 인허가
  noise?: string[];                // 소음·진동 관련 인허가
  other?: string[];                // 기타 인허가
  // 통합허가 외
  totalControl?: string[];         // 총량관리대상
  totalAllocation?: string[];      // 총량할당관리
  wastePermit?: string[];          // 폐기물 관련 허가
}

/** 적용 제도 */
export type AppliedRegime = 
  | "integrated_permit"      // 통합환경허가
  | "emission_trading"       // 배출권거래제
  | "tms_air"               // 대기TMS
  | "tms_water"             // 수질TMS
  | "chemical_registration" // 화학물질등록
  | "green_company"         // 녹색기업지정
  | "iso14001"              // ISO14001
  | "iso45001"              // ISO45001
  | "iso50001"              // ISO50001
  | "other";

export const REGIME_LABELS: Record<AppliedRegime, string> = {
  integrated_permit: "통합환경허가",
  emission_trading: "배출권거래제",
  tms_air: "대기TMS",
  tms_water: "수질TMS",
  chemical_registration: "화학물질등록",
  green_company: "녹색기업지정",
  iso14001: "ISO14001",
  iso45001: "ISO45001",
  iso50001: "ISO50001",
  other: "기타",
};

/** 현재 이슈 상황 */
export interface CurrentIssue {
  id: string;
  label: string;                   // 이슈명 (설비 증설, 민원 발생 등)
  memo?: string;                   // 상세 메모
  severity: "info" | "warning" | "critical";  // 심각도
  createdAt: string;
}

/** 탭 1: 개요 데이터 */
export interface OverviewTab {
  basicInfo: BasicInfo;
  facilitySummary: FacilitySummary;
  mediaPermits?: MediaPermits;     // 매체별 인허가 사항
  appliedRegimes: AppliedRegime[];
  certifications: string[];
  currentIssues?: CurrentIssue[];  // 현재 이슈 상황 (수동 관리)
}

// ============================================================================
// 탭 2: 배출시설 (Emission Facilities)
// 통합환경관리계획서 배출시설 목록 정규 양식 기준
// ============================================================================

/** 배출 매체 분류 */
export type EmissionMedia = "air" | "water" | "waste";  // 대기 / 수질 / 폐기물

/** 배출시설 분류 (대기) */
export type AirFacilityType = 
  | "combustion"         // 연소시설
  | "reaction"           // 반응시설
  | "drying"             // 건조시설
  | "storage"            // 저장시설
  | "transfer"           // 이송시설
  | "heating"            // 가열시설
  | "coating"            // 도장시설
  | "other";             // 기타시설

/** 배출시설 분류 (수질) */
export type WaterFacilityType = 
  | "discharge"          // 배출시설
  | "treatment"          // 처리시설
  | "cooling"            // 냉각시설
  | "other";             // 기타시설

/** 운전인자 */
export type OperatingFactor = 
  | "operating_status"   // 가동상태
  | "level"              // 레벨
  | "input_quantity"     // 원료 투입량
  | "other";             // 기타

/** 변경사항 */
export type ChangeStatus = 
  | "existing"           // 기존
  | "new"                // 신설
  | "changed"            // 변경
  | "abolished";         // 폐지

/** 배출 상세 정보 (복수 시설번호/매체 지원)
 * 
 * 하나의 관리번호에 여러 시설번호가 있고, 각각 다른 배출 매체/오염물질/배출구/법적대상여부를
 * 가지는 경우 (예: I-PU11012 - A-7/대기/먼지/#A8/대상 + Ws-4/폐기물/폐합성수지/-/비대상)
 */
export interface EmissionDetail {
  facilityNumber: string;             // 시설번호 (A-7, Ws-4 등)
  emissionMedia: EmissionMedia;       // 처리/발생 (대기/수질/폐기물)
  pollutants?: string[];              // 오염물질
  dischargePortNumber?: string;       // 배출(방류)구 번호
  isLegalTarget?: boolean;            // 법적대상여부
}

/** 배출시설 (통합환경관리계획서 정규 양식 기준)
 * 
 * 통합환경관리계획서 3.1.1 배출시설 등 표의 열 항목 기준:
 * 관리번호, 공정번호, 시설번호, 시설명, 용량, 단위, 수량,
 * 처리/발생, 오염물질, 운전인자, 설치지점, 배출(방류)구 번호,
 * 변경사항, 법적대상여부, P&ID No., 비고
 */
export interface EmissionFacility {
  id: string;
  
  // === 식별 정보 ===
  managementNumber: string;           // 관리번호 (예: I-PUI1001)
  processNumber: string;              // 공정번호 (예: PU-01-01)
  name: string;                       // 시설명 (예: 고체입자상물질 저장시설 (원료투입구) BE-800-H)
  
  // === 용량 정보 ===
  capacity?: number;                  // 용량 (예: 13.7, 66, 200)
  capacityUnit?: string;              // 단위 (예: m³, 톤/시)
  quantity?: number;                  // 수량 (기본값: 1)
  
  // === 운전/위치 정보 ===
  operatingFactor?: OperatingFactor;  // 운전인자 (가동상태, 레벨, 원료 투입량)
  operatingFactorDetail?: string;     // 운전인자 상세 (예: "가동상태", "레벨")
  installationLocation?: string;      // 설치지점 (예: "3.2 시설 배치도 참조")
  
  // === 연결 정보 ===
  linkedPreventionIds?: string[];     // 연결 방지시설 ID 목록
  
  // === 허가/규제 정보 ===
  changeStatus?: ChangeStatus;        // 변경사항 (기존/신설/변경/폐지)
  pidNumber?: string;                 // P&ID No. (예: JR-PFD-발효-001)
  
  // === 기타 정보 ===
  notes?: string;                     // 비고
  
  // === 복수 시설번호/배출정보 지원 ===
  // 하나의 관리번호에 여러 시설번호가 있는 경우 (예: I-PU11012 - A-7 + Ws-4)
  emissionDetails?: EmissionDetail[]; // 복수 배출 상세 정보
  
  // === 단일 배출 정보 (하위 호환성 및 단순 케이스용) ===
  // emissionDetails가 없는 경우 아래 필드 사용
  facilityNumber?: string;            // 시설번호 (예: A-1, A-2)
  emissionMedia?: EmissionMedia;      // 처리/발생 (대기/수질/폐기물)
  pollutants?: string[];              // 오염물질 (예: 먼지, NOx, SOx)
  dischargePortNumber?: string;       // 배출(방류)구 번호 (예: #A8, #A1, #A2)
  isLegalTarget?: boolean;            // 법적대상여부 (대상: true, 비대상: false)
  
  // === 부가 정보 (UI 표시용, 통합허가 양식 외) ===
  facilityType?: AirFacilityType | WaterFacilityType;  // 시설 세부분류
  status?: "operating" | "stopped" | "maintenance";    // 가동상태 (UI 표시용)
  installDate?: string;               // 설치일자
  manufacturer?: string;              // 제조사
  model?: string;                     // 모델
  operatingHours?: number;            // 일일 가동시간
  fuelType?: string;                  // 연료종류 (연소시설의 경우)
  fuelConsumption?: number;           // 연료사용량
  fuelUnit?: string;                  // 연료 단위
  permitLimits?: {                    // 허가 배출기준
    pollutant: string;
    limit: number;
    unit: string;
  }[];
  operatingRate?: number;             // 가동률 (%)
  lastInspectionDate?: string;        // 최근 점검일
  
  // === 하위 호환성 유지 ===
  /** @deprecated use managementNumber instead */
  code?: string;
  /** @deprecated use emissionMedia instead */
  type?: string;
  /** @deprecated use facilityType instead */
  subType?: string;
  /** @deprecated use pollutants instead */
  mainPollutants?: string[];
  /** @deprecated use dischargePortNumber instead */
  linkedStackId?: string;
}

// ============================================================================
// 탭 3: 방지시설 (Prevention Facilities)
// ============================================================================

/** 방지시설 유형 */
export type PreventionFacilityType =
  | "air_dust"           // 대기/집진
  | "air_desulfur"       // 대기/탈황
  | "air_denox"          // 대기/탈질
  | "air_voc"            // 대기/VOC처리
  | "air_odor"           // 대기/악취처리
  | "air_other"          // 대기/기타
  | "water_physical"     // 수질/물리적처리
  | "water_chemical"     // 수질/화학적처리
  | "water_biological"   // 수질/생물학적처리
  | "water_advanced"     // 수질/고도처리
  | "waste_treatment"    // 폐기물/처리
  | "noise_reduction";   // 소음/저감

/** 처리/발생 구분 */
export type TreatmentType = "generation" | "treatment";  // 발생물질 / 처리물질

/** 방지시설 상세 정보 (복수 시설번호/매체 지원)
 * 
 * 하나의 관리번호에 여러 시설번호가 있고, 각각 다른 처리/발생, 오염물질, 배출구, 법적대상여부를
 * 가지는 경우 (예: C-PP12001 - W-17/발생물질/수질오염물질/#W1/대상 + AT-9/처리물질/먼지/#A9/대상 + OT-1/처리물질/복합악취/#O9/대상)
 * 
 * 시설번호 접두사:
 * - Ws-: 폐기물 발생
 * - W-: 수질 관련 (발생/처리)
 * - AT-: 대기 처리
 * - OT-: 악취 처리
 * - A-: 대기 발생
 */
export interface PreventionDetail {
  facilityNumber: string;             // 시설번호 (Ws-1, AT-1, W-17, OT-1 등)
  treatmentType: TreatmentType;       // 처리/발생 (발생물질/처리물질)
  pollutants?: string[];              // 오염물질 (폐합성수지, 먼지, 복합악취 등)
  dischargePortNumber?: string;       // 배출(방류)구 번호 (#A1, #W1, #O9 등)
  isLegalTarget?: boolean;            // 법적대상여부
}

/** 방지시설 (통합환경관리계획서 정규 양식 기준)
 * 
 * 통합환경관리계획서 3.1.2 방지(저감)시설 표의 열 항목 기준:
 * 관리번호, 공정번호, 시설번호, 시설명, 용량, 단위, 수량,
 * 처리/발생, 오염물질, 운전인자, 설치지점, 배출(방류)구 번호,
 * 변경사항, 법적대상여부, P&ID No., 비고
 */
export interface PreventionFacility {
  id: string;
  
  // === 식별 정보 ===
  managementNumber: string;           // 관리번호 (예: C-PUI1001, C-PP12001)
  processNumber: string;              // 공정번호 (예: PU-01-01, P-01-02)
  name: string;                       // 시설명 (예: 여과집진시설 (ROOF MOUNT BAG FILTER))
  
  // === 용량 정보 ===
  capacity?: number;                  // 용량 (예: 12, 650, 160)
  capacityUnit?: string;              // 단위 (예: m³/분, Nm³/분)
  quantity?: number;                  // 수량 (기본값: 1)
  
  // === 운전/위치 정보 ===
  operatingFactor?: string;           // 운전인자 (차압, 가동상태, 전력사용량 등)
  installationLocation?: string;      // 설치지점 (예: "3.2 시설 배치도 참조")
  
  // === 연결 정보 ===
  linkedEmissionIds?: string[];       // 연결 배출시설 ID 목록
  
  // === 허가/규제 정보 ===
  changeStatus?: ChangeStatus;        // 변경사항 (기존/신설/변경/폐지)
  pidNumber?: string;                 // P&ID No. (예: DSP-1806-01-FS-001)
  
  // === 기타 정보 ===
  notes?: string;                     // 비고
  
  // === 복수 시설번호/배출정보 지원 ===
  preventionDetails?: PreventionDetail[];  // 복수 방지 상세 정보
  
  // === 단일 배출 정보 (하위 호환성) ===
  facilityNumber?: string;            // 시설번호
  treatmentType?: TreatmentType;      // 처리/발생
  pollutants?: string[];              // 오염물질
  dischargePortNumber?: string;       // 배출(방류)구 번호
  isLegalTarget?: boolean;            // 법적대상여부
  
  // === 부가 정보 (UI 표시용) ===
  facilityType?: PreventionFacilityType;  // 시설 세부분류
  status?: "operating" | "stopped" | "maintenance";  // 가동상태
  designCapacity?: string;            // 설계용량 (별도 표기)
  designEfficiency?: number;          // 설계효율 (%)
  actualEfficiency?: number;          // 실제효율 (%)
  installDate?: string;               // 설치일자
  manufacturer?: string;              // 제조사
  model?: string;                     // 모델
  chemicals?: {                       // 약품 사용
    name: string;
    consumption: number;
    unit: string;
  }[];
  consumables?: {                     // 소모품
    name: string;
    replacementCycle: string;
    lastReplacement?: string;
  }[];
  batReference?: string;              // 관련 BAT 기준
  batAelCompliance?: boolean;         // BAT-AEL 준수 여부
  
  // === 하위 호환성 ===
  /** @deprecated use managementNumber instead */
  code?: string;
  /** @deprecated use facilityType instead */
  type?: PreventionFacilityType;
  /** @deprecated use operatingFactor instead */
  treatmentMethod?: string;
}

// ============================================================================
// 탭 4: 배출/방류구 (Stacks & Discharge Points)
// ============================================================================

/** 배출구/방류구 유형 */
export type DischargePointType = "air" | "water";  // 대기 배출구 / 수질 방류구

/** 연도별 측정 데이터 (배출량 또는 농도) */
export interface YearlyMeasurement {
  year: number;                     // 연도 (예: 2019, 2020, 2021, 2022, 2023)
  value: number | null;             // 측정값 (null이면 "-" 표시)
}

/** 오염물질별 배출 데이터 */
export interface PollutantEmissionData {
  pollutant: string;                // 오염물질명 (먼지, 질소산화물, 황산화물, THC 등)
  emissionAmount?: YearlyMeasurement[];   // 연도별 배출량 (kg)
  concentration?: YearlyMeasurement[];    // 연도별 농도 (mg/Sm³, ppm 또는 mg/L)
  concentrationUnit?: string;       // 농도 단위 (mg/Sm³, ppm, mg/L)
  statistics?: {
    max: number | null;             // 최대값
    min: number | null;             // 최소값
    avg: number | null;             // 평균값
  };
}

/** 총량관리대상 배출허용총량 */
export interface EmissionAllowance {
  pollutant: string;                // 오염물질 (예: 질소산화물)
  yearlyAllowance: YearlyMeasurement[];  // 연도별 배출허용총량 (kg/년)
  isProvisional?: boolean;          // 가할당 여부
  notes?: string;                   // 비고
}

/** 배출구/방류구 (통합환경관리계획서 양식 기준)
 * 
 * 대기 배출구: 2.3.2.1 대기오염물질 배출량/농도 표
 * 수질 방류구: 2.3.2.3 수질오염물질 배출농도 표
 */
export interface Stack {
  id: string;
  
  // === 식별 정보 ===
  code: string;                     // 통합배출구/방류구 코드 (예: #A-1, #W-1)
  legacyCode?: string;              // 기존배출구 코드 (예: 12, 13)
  semsNumber?: string;              // SEMs번호 (굴뚝원격감시시스템 번호)
  name: string;                     // 명칭
  type: DischargePointType;         // 유형: "air" (대기) 또는 "water" (수질)
  
  // === 물리적 특성 (대기 배출구용) ===
  height?: number;                  // 높이 (m)
  diameter?: number;                // 직경 (m)
  
  // === 방류 경로 (수질 방류구용) ===
  dischargePath?: string[];         // 방류 경로 (예: ["(주)진로발효", "안산시 공공하수처리장", "시화호(해양방류)"])
  
  // === 배출량/농도 데이터 ===
  pollutantData?: PollutantEmissionData[];  // 오염물질별 배출 데이터
  
  // === 총량관리 (대기 배출구용) ===
  emissionAllowances?: EmissionAllowance[]; // 총량관리대상 배출허용총량
  
  // === 폐수 배출량 (수질 방류구용) ===
  wastewaterDischarge?: {
    avgDaily?: number;              // 평균 폐수배출량 (m³/일)
    maxDaily?: number;              // 최대 폐수배출량 (m³/일)
  };
  
  // === 연결 시설 ===
  linkedEmissionIds?: string[];     // 연결 배출시설
  linkedPreventionIds?: string[];   // 연결 방지시설
  
  // === TMS (굴뚝원격감시시스템) ===
  tmsInstalled: boolean;            // TMS 설치 여부
  tmsItems?: string[];              // TMS 측정항목
  tmsTransmissionInterval?: number; // 전송주기 (분)
  tmsRecipient?: string;            // 데이터 전송처
  
  // === 허가 배출기준 ===
  permitLimits?: {
    pollutant: string;
    limit: number;
    unit: string;
  }[];
  
  // === 좌표/위치 ===
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  
  // === 상태 ===
  status: "active" | "inactive";
  notes?: string;
}

// ============================================================================
// 탭 5: 공정 (Processes)
// ============================================================================

/** 공정 계층 레벨 */
export type ProcessLevel = "major" | "medium" | "unit"; // 대분류 | 중분류 | 단위공정

/** 공정 */
export interface Process {
  id: string;
  
  // === 식별 및 계층 정보 ===
  code: string;                     // 공정코드 (예: PU-01, PU-01-01)
  name: string;                     // 공정명 (예: 원료 저장공정)
  level: ProcessLevel;              // 계층 레벨
  parentCode?: string;              // 상위 공정 코드 (예: PU-01)
  
  // === 상세 설명 ===
  description?: string;             // 공정 설명 및 오염물질 발생원리
  
  // === 단위 공정 상세 (Unit Process) ===
  // 단위공정별 배출시설 표(2.1.3) 기반 데이터
  inputs?: string[];                // 투입 원료/연료 (예: 원료(곡물))
  outputs?: string[];               // 산출물/폐기물 (예: 폐합성수지, 배출가스)
  
  // === 연결 정보 ===
  linkedEmissionIds?: string[];     // 연결 배출시설 ID 목록 (I-PU11001 등)
  linkedPreventionIds?: string[];   // 연결 방지시설 ID 목록
  linkedStackIds?: string[];        // 연결 배출구 ID 목록
  
  // === 부가 정보 ===
  capacity?: string;                // 용량/규모
  location?: string;                // 설치장소
  notes?: string;                   // 비고
  
  // === 하위 호환성 (삭제 예정) ===
  sequence?: number;
  emissions?: {
    name: string;
    quantity?: number;
    unit?: string;
    linkedFacilityId?: string;
  }[];
  equipment?: string[];
  operatingConditions?: any[];
  energyConsumption?: any[];
  annualProduction?: any[];
}

// ============================================================================
// 탭 6: 물질 (Substances)
// ============================================================================

/** 원료/연료 */
export interface Material {
  id: string;
  name: string;
  type: "raw_material" | "auxiliary" | "fuel";
  casNumber?: string;
  annualUsage?: number;
  unit?: string;
  storageCapacity?: number;
  storageMethod?: string;
  hazardClass?: string;
  notes?: string;
}

/** 유해화학물질 */
export interface Chemical {
  id: string;
  name: string;
  casNumber?: string;
  classification: "toxic" | "restricted" | "prohibited" | "accident_preparedness" | "cmr" | "other";
  annualUsage?: number;
  unit?: string;
  storageCapacity?: number;
  regulatoryStatus: string[];       // 규제현황 (예: ["허가물질", "PRTR"])
  handlingPermit?: string;          // 취급허가 정보
  notes?: string;
}

/** 대기/수질 오염물질 */
export interface Pollutant {
  id: string;
  name: string;
  medium: "air" | "water";
  permitLimit?: number;
  permitUnit?: string;
  actualEmission?: number;
  actualUnit?: string;
  annualEmission?: number;
  annualUnit?: string;
  linkedFacilityIds?: string[];
  exceedanceHistory?: {
    date: string;
    value: number;
    cause?: string;
  }[];
  notes?: string;
}

/** 온실가스 배출 */
export interface GHGEmission {
  id: string;
  gasType: "CO2" | "CH4" | "N2O" | "HFCs" | "PFCs" | "SF6";
  source: string;                   // 배출원
  annualEmission?: number;          // 연간 배출량 (tCO2eq)
  allocation?: number;              // 할당량
  remaining?: number;               // 잔여량
  verificationStatus?: string;      // 검증상태
  notes?: string;
}

/** 탭 6: 물질 데이터 */
export interface SubstancesTab {
  rawMaterials: Material[];
  fuels: Material[];
  chemicals: Chemical[];
  airPollutants: Pollutant[];
  waterPollutants: Pollutant[];
  ghgEmissions: GHGEmission[];
}

// ============================================================================
// 탭 7: 허가 (Permits)
// ============================================================================

/** 허가 유형 */
export type PermitType =
  | "integrated"         // 통합환경허가
  | "air_emission"       // 대기배출시설
  | "water_discharge"    // 수질배출시설
  | "waste_disposal"     // 폐기물처리
  | "chemical_handling"  // 화학물질취급
  | "ghg_emission"       // 온실가스배출권
  | "other";

/** 허가 */
export interface Permit {
  id: string;
  type: PermitType;
  permitNumber: string;             // 허가번호
  issuedDate: string;               // 발급일
  expiryDate?: string;              // 만료일
  issuingAuthority?: string;        // 발급기관
  conditions?: string[];            // 허가조건
  attachments?: {                   // 첨부문서
    name: string;
    path?: string;
    uploadedAt?: string;
  }[];
  renewalRequired?: boolean;        // 갱신필요 여부
  daysUntilExpiry?: number;         // 만료까지 남은 일수
  status: "valid" | "expired" | "renewal_pending" | "revoked";
  linkedToIntegrated?: boolean;     // 통합허가 연계 여부
  notes?: string;
}

// ============================================================================
// 탭 8: BAT (Best Available Techniques)
// ============================================================================

/** BAT 적용 상태 */
export type BATStatus = "applied" | "in_progress" | "planned" | "not_applicable";

/** BAT 항목 */
export interface BATItem {
  id: string;
  category: string;                 // BAT 범주
  name: string;                     // BAT 항목명
  batAelStandard?: string;          // BAT-AEL 기준
  currentLevel?: string;            // 현재 수준
  status: BATStatus;
  investmentCost?: number;          // 투자비용 (억원)
  annualSavings?: number;           // 연간 절감액 (억원)
  paybackPeriod?: number;           // 투자회수기간 (년)
  costEfficiency?: number;          // 비용효율 (1-5)
  plannedCompletionDate?: string;   // 예정 완료일
  relatedRegulation?: string;       // 관련 규제
  regulationTrend?: string;         // 규제 동향
  notes?: string;
}

// ============================================================================
// 탭 9: 모니터링 (Monitoring)
// ============================================================================

/** TMS 측정지점 */
export interface TMSPoint {
  id: string;
  code: string;                     // 지점코드
  location: string;                 // 위치
  type: "air" | "water";
  measuredItems: string[];          // 측정항목
  transmissionInterval: number;     // 전송주기 (분)
  recipient: string;                // 전송처
  status: "normal" | "error" | "maintenance";
  lastDataTime?: string;
  notes?: string;
}

/** 자가측정 */
export interface SelfMeasurement {
  id: string;
  target: string;                   // 측정대상
  items: string[];                  // 측정항목
  frequency: string;                // 측정주기
  lastMeasurementDate?: string;     // 최근측정일
  nextScheduledDate?: string;       // 다음예정일
  measuringAgency?: string;         // 측정기관
  notes?: string;
}

/** 탭 9: 모니터링 데이터 */
export interface MonitoringTab {
  tmsPoints: TMSPoint[];
  selfMeasurements: SelfMeasurement[];
}

// ============================================================================
// 탭 10: 규제현황 (Regulations)
// ============================================================================

/** 적용 법령 */
export interface ApplicableLaw {
  id: string;
  name: string;                     // 법령명
  articles: string[];               // 적용 조항
  obligations: string[];            // 의무사항
  complianceStatus: "compliant" | "partial" | "non_compliant" | "under_review";
  lastChecked?: string;
  notes?: string;
}

/** 국제 규제 */
export interface InternationalRegulation {
  id: string;
  name: string;                     // 규제명 (예: EU CBAM)
  relevance: string;                // 관련 내용
  responseStatus: "completed" | "in_progress" | "planned" | "under_review";
  deadline?: string;
  notes?: string;
}

/** 탭 10: 규제현황 데이터 */
export interface RegulationsTab {
  domesticLaws: ApplicableLaw[];
  internationalRegulations: InternationalRegulation[];
}

// ============================================================================
// 탭 11: RAG 설정 (RAG Config)
// ============================================================================

/** 관심 분야 */
export type InterestSector =
  | "air_emission"       // 대기배출 규제
  | "water_discharge"    // 수질배출 규제
  | "waste_management"   // 폐기물 규제
  | "chemical_safety"    // 화학물질 규제
  | "climate_ghg"        // 기후/온실가스
  | "bat_technology"     // BAT 동향
  | "emission_trading"   // 배출권거래
  | "international_eu"   // EU 환경규제
  | "international_us"   // 미국 환경규제
  | "energy_efficiency"; // 에너지 효율

export const INTEREST_SECTOR_LABELS: Record<InterestSector, string> = {
  air_emission: "대기배출 규제",
  water_discharge: "수질배출 규제",
  waste_management: "폐기물 규제",
  chemical_safety: "화학물질 규제",
  climate_ghg: "기후/온실가스",
  bat_technology: "BAT 동향",
  emission_trading: "배출권거래",
  international_eu: "EU 환경규제",
  international_us: "미국 환경규제",
  energy_efficiency: "에너지 효율",
};

/** 임베딩 모델 타입 */
export type EmbeddingModelType = "text-embedding-3-small" | "text-embedding-3-large";

/** LLM 모델 타입 (프로파일용) */
export type ProfileLLMModel = 
  | "gpt-5-mini" | "gpt-5.2"                                    // OpenAI
  | "claude-haiku-4.5" | "claude-sonnet-4.5" | "claude-opus-4.5" // Anthropic
  | "gemini-3-flash" | "gemini-3-pro";                          // Google

/** 청킹 설정 */
export interface ChunkingConfig {
  chunkSize: number;      // 청크 크기 (토큰), 기본 500
  chunkOverlap: number;   // 오버랩 (토큰), 기본 50
  // 전략은 semantic으로 고정
}

/** 임베딩 설정 */
export interface EmbeddingConfig {
  model: EmbeddingModelType;  // 임베딩 모델
  batchSize: number;          // 배치 크기, 기본 5
}

/** LLM 분석 설정 */
export interface LLMAnalysisConfig {
  model: ProfileLLMModel;     // LLM 모델
  temperature: number;        // 기본 0.1 (정확한 추출)
  maxTokens: number;          // 기본 4096
}

/** 벡터 검색 설정 */
export interface SearchConfig {
  topK: number;               // 검색 결과 수, 기본 10
  similarityThreshold: number; // 유사도 임계값, 기본 0.7
}

/** 탭 11: RAG 설정 데이터 */
export interface RAGConfigTab {
  // 기존 필드
  prioritySectors: InterestSector[];  // 우선 모니터링 분야
  priorityKeywords: string[];         // 우선 키워드
  excludeKeywords: string[];          // 제외 키워드
  customPrompt?: string;              // 맞춤 LLM 프롬프트
  issueWeights: {                     // 이슈 발굴 가중치
    legalMandatory: number;           // 법적 강제성 (0-100)
    novelty: number;                  // 신규성 (0-100)
    impact: number;                   // 파급력 (0-100)
    international: number;            // 국제 연관성 (0-100)
  };
  
  // 신규 필드: 청킹/임베딩/LLM 설정
  chunkingConfig?: ChunkingConfig;    // 청킹 설정
  embeddingConfig?: EmbeddingConfig;  // 임베딩 설정
  llmConfig?: LLMAnalysisConfig;      // LLM 분석 설정
  searchConfig?: SearchConfig;        // 벡터 검색 설정
}

// ============================================================================
// 업로드 문서 관리
// ============================================================================

/** 업로드된 문서 */
export interface UploadedDocument {
  id: string;
  filename: string;
  originalName: string;
  fileType: "pdf" | "hwp" | "hwpx" | "docx" | "xlsx";
  fileSize: number;
  uploadedAt: string;
  docType: "full_plan" | "partial";   // 전체 계획서 / 부분 문서
  targetTabs?: string[];              // 대상 탭 (부분 문서인 경우)
  extractionStatus: "pending" | "processing" | "completed" | "failed";
  chunkCount?: number;                // 청크 수
  embeddingStatus?: "pending" | "processing" | "completed" | "failed";
  notes?: string;
}

// ============================================================================
// 사업장 프로파일 메인 인터페이스
// ============================================================================

/** 사업장 프로파일 */
export interface SiteProfile {
  id: string;
  name: string;
  code?: string;                      // 사업장 코드
  industryCategory: IndustryCategory;
  
  // 탭 1: 개요
  overview: OverviewTab;
  
  // 탭 2: 배출시설
  emissionFacilities: EmissionFacility[];
  
  // 탭 3: 방지시설
  preventionFacilities: PreventionFacility[];
  
  // 탭 4: 굴뚝
  stacks: Stack[];
  
  // 탭 5: 공정
  processes: Process[];
  
  // 탭 6: 물질
  substances: SubstancesTab;
  
  // 탭 7: 허가
  permits: Permit[];
  
  // 탭 8: BAT
  batStatus: BATItem[];
  
  // 탭 9: 모니터링
  monitoring: MonitoringTab;
  
  // 탭 10: 규제현황
  regulations: RegulationsTab;
  
  // 탭 11: RAG 설정
  ragConfig: RAGConfigTab;
  
  // 문서 관리
  uploadedDocuments: UploadedDocument[];
  
  // 메타데이터
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  lastAnalyzedAt?: string;
}

/** 프로파일 목록 아이템 */
export interface ProfileListItem {
  id: string;
  name: string;
  code?: string;
  logo?: string;
  industryCategory: IndustryCategory;
  industryLabel: string;
  scale: FacilityScale;
  scaleLabel: string;
  location: string;
  emissionFacilityCount: number;
  preventionFacilityCount: number;
  permitCount: number;
  hasIntegratedPermit: boolean;
  updatedAt: string;
}

// ============================================================================
// 기본값 생성 함수
// ============================================================================

/** 빈 프로파일 생성 */
export function createEmptyProfile(
  name: string,
  industryCategory: IndustryCategory
): SiteProfile {
  return {
    id: randomUUID(),
    name,
    industryCategory,
    overview: {
      basicInfo: {
        name,
        industryCategory,
        scale: "medium",
        location: {
          roadAddress: "",
          detailAddress: "",
          region: "",
          district: "",
        },
        industryCodes: [],
        mainProducts: [],
        facilityClass: {},
        annualEmissions: {},
        area: {},
        contact: {},
      },
      facilitySummary: {
        emissionFacilityCount: 0,
        preventionFacilityCount: 0,
        stackCount: 0,
        dischargePointCount: 0,
        processCount: 0,
        tmsInstalled: false,
      },
      appliedRegimes: [],
      certifications: [],
    },
    emissionFacilities: [],
    preventionFacilities: [],
    stacks: [],
    processes: [],
    substances: {
      rawMaterials: [],
      fuels: [],
      chemicals: [],
      airPollutants: [],
      waterPollutants: [],
      ghgEmissions: [],
    },
    permits: [],
    batStatus: [],
    monitoring: {
      tmsPoints: [],
      selfMeasurements: [],
    },
    regulations: {
      domesticLaws: [],
      internationalRegulations: [],
    },
    ragConfig: {
      prioritySectors: [],
      priorityKeywords: [],
      excludeKeywords: [],
      issueWeights: {
        legalMandatory: 80,
        novelty: 60,
        impact: 90,
        international: 70,
      },
      // 청킹/임베딩/LLM 기본 설정
      chunkingConfig: {
        chunkSize: 350,     // 350 토큰 (한글 보수적 계산 기준)
        chunkOverlap: 50,   // 50 토큰
      },
      embeddingConfig: {
        model: "text-embedding-3-small",
        batchSize: 5,
      },
      llmConfig: {
        model: "gpt-5-mini",
        temperature: 0.1,
        maxTokens: 4096,
      },
      searchConfig: {
        topK: 10,
        similarityThreshold: 0.5,  // 0.7은 너무 높아서 대부분 필터링됨
      },
    },
    uploadedDocuments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// 파일 경로
// ============================================================================

const DATA_DIR = path.join(process.cwd(), "data");
const PROFILES_DIR = path.join(DATA_DIR, "site-profiles");

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

// ============================================================================
// 프로파일 CRUD
// ============================================================================

/**
 * 새 프로파일 생성
 */
export function createProfile(
  name: string,
  industryCategory: IndustryCategory,
  basicInfo?: Partial<BasicInfo>
): SiteProfile {
  ensureDirectories();
  
  const profile = createEmptyProfile(name, industryCategory);
  
  if (basicInfo) {
    profile.overview.basicInfo = {
      ...profile.overview.basicInfo,
      ...basicInfo,
    };
  }
  
  saveProfile(profile);
  return profile;
}

/**
 * 프로파일 저장
 */
export function saveProfile(profile: SiteProfile): void {
  ensureDirectories();
  
  const filePath = path.join(PROFILES_DIR, `${profile.id}.json`);
  profile.updatedAt = new Date().toISOString();
  
  // facilitySummary 자동 계산
  profile.overview.facilitySummary = {
    emissionFacilityCount: profile.emissionFacilities.length,
    preventionFacilityCount: profile.preventionFacilities.length,
    stackCount: profile.stacks.filter(s => s.type === "stack").length,
    dischargePointCount: profile.stacks.filter(s => s.type === "discharge_point").length,
    processCount: profile.processes.length,
    tmsInstalled: profile.stacks.some(s => s.tmsInstalled) || profile.monitoring.tmsPoints.length > 0,
  };
  
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf-8");
}

/**
 * 프로파일 로드
 */
export function loadProfile(profileId: string): SiteProfile | null {
  const filePath = path.join(PROFILES_DIR, `${profileId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Failed to load profile ${profileId}:`, error);
  }
  
  return null;
}

/**
 * 프로파일 삭제
 */
export function deleteProfile(profileId: string): boolean {
  const filePath = path.join(PROFILES_DIR, `${profileId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete profile ${profileId}:`, error);
  }
  
  return false;
}

/**
 * 프로파일 목록 조회
 */
export function listProfiles(): ProfileListItem[] {
  ensureDirectories();
  
  const profiles: ProfileListItem[] = [];
  
  try {
    const files = fs.readdirSync(PROFILES_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      const filePath = path.join(PROFILES_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const profile: SiteProfile = JSON.parse(data);
        const industryInfo = INDUSTRY_CATEGORY_MAP[profile.industryCategory];
        
        profiles.push({
          id: profile.id,
          name: profile.name,
          code: profile.code,
          logo: profile.overview.basicInfo.logo,
          industryCategory: profile.industryCategory,
          industryLabel: industryInfo?.label || profile.industryCategory,
          scale: profile.overview.basicInfo.scale,
          scaleLabel: SCALE_LABELS[profile.overview.basicInfo.scale] || "",
          location: profile.overview.basicInfo.location.region || profile.overview.basicInfo.location.address,
          emissionFacilityCount: profile.emissionFacilities.length,
          preventionFacilityCount: profile.preventionFacilities.length,
          permitCount: profile.permits.length,
          hasIntegratedPermit: profile.permits.some(p => p.type === "integrated"),
          updatedAt: profile.updatedAt,
        });
      } catch {
        // 파싱 실패 무시
      }
    }
  } catch (error) {
    console.error("Failed to list profiles:", error);
  }
  
  // 이름순 정렬
  profiles.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  
  return profiles;
}

/**
 * 업종별 프로파일 목록 조회
 */
export function listProfilesByIndustry(industryCategory: IndustryCategory): ProfileListItem[] {
  return listProfiles().filter(p => p.industryCategory === industryCategory);
}

/**
 * 업종별 프로파일 수 집계
 */
export function countProfilesByIndustry(): Record<IndustryCategory, number> {
  const profiles = listProfiles();
  const counts: Record<string, number> = {};
  
  for (const cat of INDUSTRY_CATEGORIES) {
    counts[cat.id] = 0;
  }
  
  for (const profile of profiles) {
    if (counts[profile.industryCategory] !== undefined) {
      counts[profile.industryCategory]++;
    }
  }
  
  return counts as Record<IndustryCategory, number>;
}

// ============================================================================
// RAG 연동용 유틸리티
// ============================================================================

/**
 * 프로파일에서 RAG 컨텍스트 생성
 */
export function generateProfileContext(profile: SiteProfile): string {
  const lines: string[] = [];
  const industryInfo = INDUSTRY_CATEGORY_MAP[profile.industryCategory];
  
  lines.push(`## 사업장 정보: ${profile.name}`);
  lines.push(`- 업종: ${industryInfo?.label || profile.industryCategory}`);
  lines.push(`- 규모: ${SCALE_LABELS[profile.overview.basicInfo.scale]}`);
  lines.push(`- 지역: ${profile.overview.basicInfo.location.region}`);
  
  // 시설 현황
  const summary = profile.overview.facilitySummary;
  lines.push(`\n### 시설 현황`);
  lines.push(`- 배출시설: ${summary.emissionFacilityCount}개`);
  lines.push(`- 방지시설: ${summary.preventionFacilityCount}개`);
  lines.push(`- 굴뚝: ${summary.stackCount}기`);
  if (summary.tmsInstalled) {
    lines.push(`- TMS 설치: 예`);
  }
  
  // 주요 배출물질
  if (profile.substances.airPollutants.length > 0) {
    lines.push(`\n### 주요 대기오염물질`);
    for (const p of profile.substances.airPollutants.slice(0, 5)) {
      lines.push(`- ${p.name}`);
    }
  }
  
  // 허가 현황
  if (profile.permits.length > 0) {
    lines.push(`\n### 보유 허가`);
    for (const permit of profile.permits.slice(0, 5)) {
      lines.push(`- ${permit.type === "integrated" ? "통합환경허가" : permit.type} (${permit.permitNumber})`);
    }
  }
  
  // 적용 규제
  if (profile.regulations.domesticLaws.length > 0) {
    lines.push(`\n### 적용 법령`);
    for (const law of profile.regulations.domesticLaws.slice(0, 5)) {
      lines.push(`- ${law.name}`);
    }
  }
  
  // 적용 제도
  if (profile.overview.appliedRegimes.length > 0) {
    lines.push(`\n### 해당 제도`);
    const regimeLabels = profile.overview.appliedRegimes.map(r => REGIME_LABELS[r] || r);
    lines.push(regimeLabels.join(", "));
  }
  
  // 맞춤 프롬프트
  if (profile.ragConfig.customPrompt) {
    lines.push(`\n### 분석 요청사항`);
    lines.push(profile.ragConfig.customPrompt);
  }
  
  return lines.join("\n");
}

/**
 * 프로파일 기반 검색 필터 생성
 */
export function generateProfileFilter(profile: SiteProfile): Record<string, any> {
  const filter: Record<string, any> = {};
  
  // 우선 관심 분야로 필터
  if (profile.ragConfig.prioritySectors.length > 0) {
    filter.sectors = profile.ragConfig.prioritySectors;
  }
  
  // 업종 관련 키워드
  const industryInfo = INDUSTRY_CATEGORY_MAP[profile.industryCategory];
  if (industryInfo) {
    filter.industryKeywords = [industryInfo.label];
  }
  
  return filter;
}
