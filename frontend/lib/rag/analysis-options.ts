/**
 * RAG 분석 옵션 상수 및 프롬프트 생성 유틸
 *
 * 사업장 맞춤형 이슈 발굴을 위한 3개 카테고리(통합허가/기후변화/산업안전) × 10개 옵션
 * 프론트엔드 UI와 discovery API 양쪽에서 공유하여 사용
 */

// ============================================================================
// 타입 정의
// ============================================================================

export interface AnalysisOption {
  id: string;
  label: string;
  description: string; // ? 아이콘 tooltip에 표시
}

export interface AnalysisCategory {
  id: string;
  label: string;
  iconName: string; // lucide 아이콘 이름 (프론트에서 매핑)
  options: AnalysisOption[];
}

// ============================================================================
// 분석 옵션 상수 (3 카테고리 × 10 옵션 = 30개)
// ============================================================================

export const ANALYSIS_CATEGORIES: AnalysisCategory[] = [
  {
    id: "integrated_permit",
    label: "통합허가",
    iconName: "Shield",
    options: [
      {
        id: "bat_update",
        label: "BAT 기준 변경",
        description: "최적가용기법(BAT) 기준서 개정/신규 고시 모니터링",
      },
      {
        id: "emission_standard",
        label: "배출허용기준 강화",
        description: "대기/수질/소음 등 매체별 배출허용기준 변경 동향",
      },
      {
        id: "permit_renewal",
        label: "허가 갱신/변경 요건",
        description: "통합허가 갱신 주기, 변경허가 사유 관련 제도 변화",
      },
      {
        id: "self_monitoring",
        label: "자가측정 의무",
        description: "자가측정 항목/주기/방법 변경 사항",
      },
      {
        id: "compliance_check",
        label: "이행점검 강화",
        description: "통합허가 이행점검 기준 및 절차 변경",
      },
      {
        id: "prevention_tech",
        label: "방지시설 기술기준",
        description: "방지시설 설치/운영 기술기준 개정",
      },
      {
        id: "penalty_sanction",
        label: "행정처분/과징금",
        description: "위반 시 벌칙, 과징금, 행정처분 기준 변경",
      },
      {
        id: "facility_change",
        label: "배출시설 설치/변경",
        description: "배출시설 신규 설치·변경 시 허가 요건 변화",
      },
      {
        id: "eia_review",
        label: "환경영향평가",
        description: "환경영향평가·사전환경성검토 제도 변경",
      },
      {
        id: "waste_management",
        label: "폐기물 관리 강화",
        description: "사업장 폐기물 처리·위탁 기준 및 감량 의무",
      },
    ],
  },
  {
    id: "climate_change",
    label: "기후변화",
    iconName: "Globe",
    options: [
      {
        id: "ets_trading",
        label: "배출권거래제",
        description: "온실가스 배출권 할당/거래/유상할당 비율 변화",
      },
      {
        id: "carbon_neutral",
        label: "탄소중립 로드맵",
        description: "국가·업종별 탄소중립 이행 목표 및 계획",
      },
      {
        id: "eu_cbam",
        label: "EU CBAM 대응",
        description: "탄소국경조정메커니즘 시행에 따른 규제 및 대응",
      },
      {
        id: "renewable_energy",
        label: "신재생에너지 정책",
        description: "RPS/REC/FIT 등 재생에너지 의무 및 지원 정책",
      },
      {
        id: "re100_ppa",
        label: "RE100/PPA",
        description: "RE100 이행, 전력구매계약(PPA) 관련 제도",
      },
      {
        id: "esg_disclosure",
        label: "ESG 공시/보고",
        description: "ESG·TCFD·ISSB 등 기후 관련 공시 의무화",
      },
      {
        id: "green_finance",
        label: "녹색금융/분류체계",
        description: "K-택소노미, 녹색채권 등 녹색금융 제도",
      },
      {
        id: "energy_efficiency",
        label: "에너지 효율 규제",
        description: "에너지 이용 합리화, 고효율 설비 의무 등",
      },
      {
        id: "carbon_tax",
        label: "탄소세/탄소가격",
        description: "탄소세 도입 논의, 배출권 가격 전망",
      },
      {
        id: "climate_adaptation",
        label: "기후위기 적응",
        description: "기후변화 적응 대책, 물리적 리스크 관리",
      },
    ],
  },
  {
    id: "industrial_safety",
    label: "산업안전",
    iconName: "HardHat",
    options: [
      {
        id: "serious_disaster",
        label: "중대재해처벌법",
        description: "중대재해 처벌법 적용 범위·의무 변경",
      },
      {
        id: "chemical_mgmt",
        label: "화학물질관리법",
        description: "화학물질 등록/인가/제한 제도 변경",
      },
      {
        id: "risk_assessment",
        label: "위험성평가 의무",
        description: "위험성평가 대상·방법·주기 관련 규제",
      },
      {
        id: "osh_amendment",
        label: "산업안전보건법 개정",
        description: "산안법 주요 개정 사항 및 하위법령 변화",
      },
      {
        id: "offsite_impact",
        label: "장외영향평가",
        description: "장외영향평가 대상 확대 및 기준 변경",
      },
      {
        id: "psm_report",
        label: "공정안전보고서(PSM)",
        description: "공정안전관리 보고서 제출·심사 기준 변화",
      },
      {
        id: "accident_prevent",
        label: "화학사고 예방관리",
        description: "화학사고 예방관리계획 수립·이행 기준",
      },
      {
        id: "safety_training",
        label: "안전보건 교육",
        description: "안전보건교육 의무 대상·내용·시간 변경",
      },
      {
        id: "work_environment",
        label: "작업환경측정",
        description: "작업환경측정 대상물질·주기·방법 변화",
      },
      {
        id: "high_risk_work",
        label: "고위험 작업관리",
        description: "밀폐공간·고소작업 등 고위험 작업 규제 강화",
      },
    ],
  },
];

// ============================================================================
// 프롬프트 생성 함수
// ============================================================================

/**
 * 선택된 분석 옵션을 기반으로 LLM 프롬프트 컨텍스트 문자열 생성
 * @param options - 카테고리 ID → 선택된 옵션 ID 배열
 * @returns 프롬프트에 삽입할 분석 관점 텍스트
 */
export function generateOptionsContext(
  options: Record<string, string[]>
): string {
  const lines: string[] = [];
  let hasAny = false;

  for (const category of ANALYSIS_CATEGORIES) {
    const selected = options[category.id];
    if (!selected || selected.length === 0) continue;

    hasAny = true;
    lines.push(`### ${category.label} 관점`);

    for (const optId of selected) {
      const opt = category.options.find((o) => o.id === optId);
      if (opt) {
        lines.push(`- ${opt.label}: ${opt.description}`);
      }
    }
    lines.push("");
  }

  if (!hasAny) return "";

  return `## 분석 옵션 (사용자 선택 관점)\n아래 관점에서 이슈의 관련성과 중요도를 중점적으로 평가해 주세요.\n\n${lines.join("\n")}`;
}

/**
 * 선택된 옵션의 총 개수 반환
 */
export function countSelectedOptions(
  options: Record<string, string[]>
): number {
  return Object.values(options).reduce((sum, arr) => sum + arr.length, 0);
}
