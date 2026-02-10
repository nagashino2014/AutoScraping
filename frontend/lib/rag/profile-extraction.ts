/**
 * 사업장 프로파일 LLM 정보 추출
 * 
 * 통합환경관리계획서에서 각 탭별 정보를 LLM을 통해 자동 추출
 */

import {
  SiteProfile,
  EmissionFacility,
  PreventionFacility,
  Stack,
  Process,
  Chemical,
  Pollutant,
  GHGEmission,
  Permit,
  BATItem,
  TMSPoint,
  SelfMeasurement,
  ApplicableLaw,
} from "./site-profile";

// ============================================================
// 탭별 추출 프롬프트
// ============================================================

export const TAB_EXTRACTION_PROMPTS: Record<string, string> = {
  // 탭 1: 개요 (기본 정보)
  overview: `다음 통합환경관리계획서 내용에서 사업장 기본 정보를 추출하세요.

추출 항목:
- 사업장명
- 법인명 (있는 경우)
- 대표자명
- 사업자등록번호
- 소재지 (주소)
- 종업원 수
- 설립일
- 부지면적, 건축연면적
- 적용 제도 (통합환경허가, 배출권거래제, TMS 등)

JSON 형식으로 출력:
{
  "name": "사업장명",
  "corporateName": "법인명",
  "representative": "대표자",
  "businessNumber": "사업자등록번호",
  "address": "주소",
  "region": "시/도",
  "employees": 숫자,
  "establishment": "YYYY-MM-DD",
  "siteArea": 숫자,
  "buildingArea": 숫자,
  "appliedRegimes": ["integrated_permit", "emission_trading", ...]
}`,

  // 탭 2: 배출시설
  emissionFacilities: `다음 문서에서 배출시설 정보를 모두 추출하세요.

각 배출시설에 대해 추출:
- 시설코드 (예: A-01, B-01)
- 시설명
- 시설분류 (대기/수질)
- 세부분류 (연소시설, 반응시설, 건조시설 등)
- 용량/규모 및 단위
- 연료종류
- 연료사용량
- 연결 굴뚝
- 주요 배출물질
- 허가 배출기준

JSON 배열 형식으로 출력:
[
  {
    "code": "A-01",
    "name": "보일러",
    "type": "air_combustion",
    "subType": "연소시설",
    "capacity": "50",
    "capacityUnit": "톤/hr",
    "fuelType": "LNG",
    "linkedStackId": "굴뚝1",
    "mainPollutants": ["NOx", "SOx", "PM"],
    "permitLimits": [{"pollutant": "NOx", "limit": 120, "unit": "ppm"}]
  }
]`,

  // 탭 3: 방지시설
  preventionFacilities: `다음 문서에서 오염방지시설 정보를 모두 추출하세요.

각 방지시설에 대해 추출:
- 시설코드
- 시설명
- 시설유형 (집진, 탈황, 탈질, VOC처리, 수질처리 등)
- 처리방식
- 설계용량
- 설계효율
- 연결 배출시설
- 약품 사용 정보
- BAT 관련 기준

JSON 배열 형식으로 출력:
[
  {
    "code": "AP-01",
    "name": "SCR 탈질설비",
    "type": "air_denox",
    "treatmentMethod": "선택적촉매환원법",
    "designCapacity": "50000㎥/h",
    "designEfficiency": 95,
    "linkedEmissionIds": ["A-01"],
    "chemicals": [{"name": "암모니아수", "consumption": 8, "unit": "톤/월"}],
    "batReference": "BAT-AEL"
  }
]`,

  // 탭 4: 굴뚝
  stacks: `다음 문서에서 굴뚝 및 배출구 정보를 추출하세요.

추출 항목:
- 굴뚝/배출구 코드
- 명칭
- 높이 (m)
- 직경 (m)
- 연결 배출시설
- TMS 설치 여부
- TMS 측정항목
- 허가 배출기준

JSON 배열 형식으로 출력:
[
  {
    "code": "ST-01",
    "name": "1호굴뚝",
    "type": "stack",
    "height": 80,
    "diameter": 3.5,
    "linkedEmissionIds": ["A-01", "A-02"],
    "tmsInstalled": true,
    "tmsItems": ["NOx", "SOx", "먼지", "유속", "온도"],
    "permitLimits": [{"pollutant": "NOx", "limit": 120, "unit": "ppm"}]
  }
]`,

  // 탭 5: 공정
  processes: `다음 문서에서 제조 공정 정보를 추출하세요.

각 공정에 대해 추출:
- 공정코드
- 공정명
- 공정 설명
- 투입물 (원료, 연료 등)
- 산출물 (제품)
- 배출물 (오염물질)
- 주요 설비
- 운전조건

JSON 배열 형식으로 출력:
[
  {
    "code": "PR-01",
    "name": "나프타분해",
    "description": "나프타를 고온에서 열분해하여 에틸렌, 프로필렌 생산",
    "inputs": [{"name": "나프타", "quantity": 1000, "unit": "톤/일"}],
    "outputs": [{"name": "에틸렌", "quantity": 500, "unit": "톤/일"}],
    "emissions": [{"name": "NOx", "linkedFacilityId": "A-01"}],
    "equipment": ["분해로", "급랭탑"],
    "operatingConditions": [{"parameter": "온도", "value": "850", "unit": "℃"}]
  }
]`,

  // 탭 6: 물질 - 화학물질
  chemicals: `다음 문서에서 사용 화학물질 정보를 추출하세요.

특히 유해화학물질, 유독물질, 사고대비물질 등을 중점 추출:
- 물질명
- CAS 번호
- 분류 (유독물질, CMR, 사고대비물질 등)
- 연간 사용량
- 저장량
- 규제 현황

JSON 배열 형식으로 출력:
[
  {
    "name": "벤젠",
    "casNumber": "71-43-2",
    "classification": "cmr",
    "annualUsage": 500,
    "unit": "톤/년",
    "regulatoryStatus": ["허가물질", "PRTR"]
  }
]`,

  // 탭 6: 물질 - 대기오염물질
  airPollutants: `다음 문서에서 대기오염물질 배출 정보를 추출하세요.

추출 항목:
- 물질명
- 허가 배출기준
- 실측 농도
- 연간 배출량
- 배출시설

JSON 배열 형식으로 출력:
[
  {
    "name": "NOx",
    "permitLimit": 120,
    "permitUnit": "ppm",
    "actualEmission": 85,
    "annualEmission": 450,
    "annualUnit": "톤/년"
  }
]`,

  // 탭 6: 물질 - 온실가스
  ghgEmissions: `다음 문서에서 온실가스 배출 정보를 추출하세요.

추출 항목:
- 온실가스 종류 (CO2, CH4, N2O 등)
- 배출원
- 연간 배출량 (tCO2eq)
- 할당량
- 검증 상태

JSON 배열 형식으로 출력:
[
  {
    "gasType": "CO2",
    "source": "연소",
    "annualEmission": 850000,
    "allocation": 900000
  }
]`,

  // 탭 7: 허가
  permits: `다음 문서에서 인허가 정보를 추출하세요.

추출 항목:
- 허가 종류 (통합환경허가, 대기배출, 수질배출 등)
- 허가번호
- 발급일
- 만료일
- 주요 허가조건

JSON 배열 형식으로 출력:
[
  {
    "type": "integrated",
    "permitNumber": "IEP-2021-001234",
    "issuedDate": "2021-05-01",
    "expiryDate": "2026-05-01",
    "conditions": ["NOx 120ppm 이하", "굴뚝 TMS 운영"]
  }
]`,

  // 탭 8: BAT
  batStatus: `다음 문서에서 BAT(최적가용기법) 적용 현황을 추출하세요.

추출 항목:
- BAT 범주
- BAT 항목명
- BAT-AEL 기준
- 현재 적용 수준
- 적용 상태 (적용완료/진행중/예정)
- 투자비용
- 예상 절감액

JSON 배열 형식으로 출력:
[
  {
    "category": "대기오염 저감",
    "name": "NOx 저감 (SCR)",
    "batAelStandard": "<150mg/Nm³",
    "currentLevel": "80mg/Nm³",
    "status": "applied",
    "investmentCost": 50,
    "annualSavings": 10
  }
]`,

  // 탭 9: 모니터링 - TMS
  tmsPoints: `다음 문서에서 TMS(굴뚝자동측정기기) 정보를 추출하세요.

추출 항목:
- 측정지점 코드
- 위치
- 측정항목
- 전송주기
- 데이터 전송처

JSON 배열 형식으로 출력:
[
  {
    "code": "TMS-A01",
    "location": "1호굴뚝",
    "type": "air",
    "measuredItems": ["NOx", "SOx", "먼지", "유속", "온도", "O2"],
    "transmissionInterval": 5,
    "recipient": "국립환경과학원"
  }
]`,

  // 탭 9: 모니터링 - 자가측정
  selfMeasurements: `다음 문서에서 자가측정 계획을 추출하세요.

추출 항목:
- 측정대상
- 측정항목
- 측정주기
- 측정기관

JSON 배열 형식으로 출력:
[
  {
    "target": "1호굴뚝",
    "items": ["중금속", "다이옥신"],
    "frequency": "반기 1회",
    "measuringAgency": "환경측정대행업체"
  }
]`,

  // 탭 10: 규제현황
  regulations: `다음 문서에서 적용 법령 및 규제 정보를 추출하세요.

추출 항목:
- 법령명
- 적용 조항
- 의무사항
- 준수 상태

JSON 배열 형식으로 출력:
[
  {
    "name": "대기환경보전법",
    "articles": ["제23조", "제26조"],
    "obligations": ["배출시설 설치허가", "자가측정"],
    "complianceStatus": "compliant"
  }
]`,
};

// ============================================================
// LLM 호출 함수
// ============================================================

export interface ExtractionResult {
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
}

/**
 * LLM을 통한 정보 추출
 */
export async function extractWithLLM(
  context: string,
  tabId: string,
  apiKey: string,
  model: string = "gpt-4o"
): Promise<ExtractionResult> {
  const prompt = TAB_EXTRACTION_PROMPTS[tabId];
  
  if (!prompt) {
    return { success: false, error: `알 수 없는 탭: ${tabId}` };
  }
  
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "당신은 통합환경관리계획서를 분석하여 구조화된 정보를 추출하는 전문가입니다. 반드시 요청된 JSON 형식으로만 응답하세요. 문서에 해당 정보가 없으면 빈 배열 또는 null을 반환하세요.",
          },
          {
            role: "user",
            content: `${prompt}\n\n---\n문서 내용:\n${context}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: error.error?.message || `API 오류: ${response.status}` };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return { success: false, error: "빈 응답" };
    }
    
    try {
      const parsed = JSON.parse(content);
      return {
        success: true,
        data: parsed,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch {
      return { success: false, error: "JSON 파싱 실패" };
    }
    
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// 프로파일 자동 매핑
// ============================================================

/**
 * 추출된 데이터를 프로파일에 매핑
 */
export function mapExtractedDataToProfile(
  profile: SiteProfile,
  tabId: string,
  extractedData: any
): Partial<SiteProfile> {
  const updates: Partial<SiteProfile> = {};
  
  switch (tabId) {
    case "overview":
      if (extractedData) {
        updates.overview = {
          ...profile.overview,
          basicInfo: {
            ...profile.overview.basicInfo,
            name: extractedData.name || profile.overview.basicInfo.name,
            corporateName: extractedData.corporateName,
            representative: extractedData.representative,
            businessNumber: extractedData.businessNumber,
            employees: extractedData.employees,
            establishment: extractedData.establishment,
            siteArea: extractedData.siteArea,
            buildingArea: extractedData.buildingArea,
            location: {
              ...profile.overview.basicInfo.location,
              address: extractedData.address || profile.overview.basicInfo.location.address,
              region: extractedData.region || profile.overview.basicInfo.location.region,
            },
          },
          appliedRegimes: extractedData.appliedRegimes || profile.overview.appliedRegimes,
        };
      }
      break;
      
    case "emissionFacilities":
      if (Array.isArray(extractedData)) {
        updates.emissionFacilities = extractedData.map((item: any, idx: number) => ({
          id: `ef_${idx}`,
          code: item.code || `AE-${idx + 1}`,
          name: item.name || "",
          type: item.type || "air_combustion",
          subType: item.subType,
          capacity: item.capacity,
          capacityUnit: item.capacityUnit,
          fuelType: item.fuelType,
          linkedStackId: item.linkedStackId,
          mainPollutants: item.mainPollutants || [],
          permitLimits: item.permitLimits || [],
          status: "operating",
        })) as EmissionFacility[];
      }
      break;
      
    case "preventionFacilities":
      if (Array.isArray(extractedData)) {
        updates.preventionFacilities = extractedData.map((item: any, idx: number) => ({
          id: `pf_${idx}`,
          code: item.code || `AP-${idx + 1}`,
          name: item.name || "",
          type: item.type || "air_other",
          treatmentMethod: item.treatmentMethod,
          designCapacity: item.designCapacity,
          designEfficiency: item.designEfficiency,
          linkedEmissionIds: item.linkedEmissionIds || [],
          chemicals: item.chemicals || [],
          batReference: item.batReference,
          status: "operating",
        })) as PreventionFacility[];
      }
      break;
      
    case "stacks":
      if (Array.isArray(extractedData)) {
        updates.stacks = extractedData.map((item: any, idx: number) => ({
          id: `st_${idx}`,
          code: item.code || `ST-${idx + 1}`,
          name: item.name || "",
          type: item.type || "stack",
          height: item.height,
          diameter: item.diameter,
          linkedEmissionIds: item.linkedEmissionIds || [],
          tmsInstalled: item.tmsInstalled || false,
          tmsItems: item.tmsItems || [],
          permitLimits: item.permitLimits || [],
          status: "active",
        })) as Stack[];
      }
      break;
      
    case "processes":
      if (Array.isArray(extractedData)) {
        updates.processes = extractedData.map((item: any, idx: number) => ({
          id: `pr_${idx}`,
          code: item.code || `PR-${idx + 1}`,
          name: item.name || "",
          description: item.description,
          sequence: idx + 1,
          inputs: item.inputs || [],
          outputs: item.outputs || [],
          emissions: item.emissions || [],
          equipment: item.equipment || [],
          operatingConditions: item.operatingConditions || [],
        })) as Process[];
      }
      break;
      
    case "chemicals":
      if (Array.isArray(extractedData)) {
        updates.substances = {
          ...profile.substances,
          chemicals: extractedData.map((item: any, idx: number) => ({
            id: `ch_${idx}`,
            name: item.name || "",
            casNumber: item.casNumber,
            classification: item.classification || "other",
            annualUsage: item.annualUsage,
            unit: item.unit,
            regulatoryStatus: item.regulatoryStatus || [],
          })) as Chemical[],
        };
      }
      break;
      
    case "airPollutants":
      if (Array.isArray(extractedData)) {
        updates.substances = {
          ...profile.substances,
          airPollutants: extractedData.map((item: any, idx: number) => ({
            id: `ap_${idx}`,
            name: item.name || "",
            medium: "air",
            permitLimit: item.permitLimit,
            permitUnit: item.permitUnit,
            actualEmission: item.actualEmission,
            annualEmission: item.annualEmission,
            annualUnit: item.annualUnit,
          })) as Pollutant[],
        };
      }
      break;
      
    case "ghgEmissions":
      if (Array.isArray(extractedData)) {
        updates.substances = {
          ...profile.substances,
          ghgEmissions: extractedData.map((item: any, idx: number) => ({
            id: `ghg_${idx}`,
            gasType: item.gasType || "CO2",
            source: item.source || "",
            annualEmission: item.annualEmission,
            allocation: item.allocation,
          })) as GHGEmission[],
        };
      }
      break;
      
    case "permits":
      if (Array.isArray(extractedData)) {
        updates.permits = extractedData.map((item: any, idx: number) => ({
          id: `pm_${idx}`,
          type: item.type || "other",
          permitNumber: item.permitNumber || "",
          issuedDate: item.issuedDate || "",
          expiryDate: item.expiryDate,
          conditions: item.conditions || [],
          status: "valid",
        })) as Permit[];
      }
      break;
      
    case "batStatus":
      if (Array.isArray(extractedData)) {
        updates.batStatus = extractedData.map((item: any, idx: number) => ({
          id: `bat_${idx}`,
          category: item.category || "",
          name: item.name || "",
          batAelStandard: item.batAelStandard,
          currentLevel: item.currentLevel,
          status: item.status || "applied",
          investmentCost: item.investmentCost,
          annualSavings: item.annualSavings,
        })) as BATItem[];
      }
      break;
      
    case "tmsPoints":
      if (Array.isArray(extractedData)) {
        updates.monitoring = {
          ...profile.monitoring,
          tmsPoints: extractedData.map((item: any, idx: number) => ({
            id: `tms_${idx}`,
            code: item.code || `TMS-${idx + 1}`,
            location: item.location || "",
            type: item.type || "air",
            measuredItems: item.measuredItems || [],
            transmissionInterval: item.transmissionInterval || 5,
            recipient: item.recipient || "",
            status: "normal",
          })) as TMSPoint[],
        };
      }
      break;
      
    case "selfMeasurements":
      if (Array.isArray(extractedData)) {
        updates.monitoring = {
          ...profile.monitoring,
          selfMeasurements: extractedData.map((item: any, idx: number) => ({
            id: `sm_${idx}`,
            target: item.target || "",
            items: item.items || [],
            frequency: item.frequency || "",
            measuringAgency: item.measuringAgency,
          })) as SelfMeasurement[],
        };
      }
      break;
      
    case "regulations":
      if (Array.isArray(extractedData)) {
        updates.regulations = {
          ...profile.regulations,
          domesticLaws: extractedData.map((item: any, idx: number) => ({
            id: `law_${idx}`,
            name: item.name || "",
            articles: item.articles || [],
            obligations: item.obligations || [],
            complianceStatus: item.complianceStatus || "compliant",
          })) as ApplicableLaw[],
        };
      }
      break;
  }
  
  return updates;
}

// ============================================================
// 전체 추출 프로세스
// ============================================================

export interface FullExtractionResult {
  success: boolean;
  extractedTabs: string[];
  failedTabs: string[];
  totalTokensUsed: number;
  errors: Record<string, string>;
}

/**
 * 모든 탭에 대해 정보 추출 실행
 */
export async function extractAllTabs(
  context: string,
  apiKey: string,
  tabsToExtract?: string[]
): Promise<{ results: Record<string, ExtractionResult>; summary: FullExtractionResult }> {
  const tabs = tabsToExtract || [
    "overview",
    "emissionFacilities",
    "preventionFacilities",
    "stacks",
    "processes",
    "chemicals",
    "airPollutants",
    "ghgEmissions",
    "permits",
    "batStatus",
    "tmsPoints",
    "selfMeasurements",
    "regulations",
  ];
  
  const results: Record<string, ExtractionResult> = {};
  const summary: FullExtractionResult = {
    success: true,
    extractedTabs: [],
    failedTabs: [],
    totalTokensUsed: 0,
    errors: {},
  };
  
  for (const tabId of tabs) {
    const result = await extractWithLLM(context, tabId, apiKey);
    results[tabId] = result;
    
    if (result.success) {
      summary.extractedTabs.push(tabId);
      summary.totalTokensUsed += result.tokensUsed || 0;
    } else {
      summary.failedTabs.push(tabId);
      summary.errors[tabId] = result.error || "알 수 없는 오류";
      summary.success = false;
    }
    
    // Rate limit 방지를 위한 딜레이
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return { results, summary };
}
