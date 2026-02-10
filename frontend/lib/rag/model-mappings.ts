/**
 * LLM 모델 매핑 관리
 * 
 * 내부 모델 ID를 실제 API 모델 ID로 매핑하고,
 * 주기적으로 최신 모델 정보를 자동 업데이트합니다.
 */

import fs from "fs";
import path from "path";

// ============================================================
// 타입 정의
// ============================================================

export interface ModelMappings {
  version: string;
  lastUpdated: string;
  autoUpdateEnabled: boolean;
  updateIntervalDays: number;
  mappings: {
    openai: Record<string, string>;
    anthropic: Record<string, string>;
    google: Record<string, string>;
  };
  availableModels: {
    openai: string[];
    anthropic: string[];
    google: string[];
  };
}

export interface ModelUpdateResult {
  success: boolean;
  provider: string;
  models?: string[];
  error?: string;
}

// ============================================================
// 설정 파일 경로
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const MAPPINGS_FILE = path.join(DATA_DIR, "model-mappings.json");

// ============================================================
// 기본 매핑 (fallback)
// ============================================================

const DEFAULT_MAPPINGS: ModelMappings = {
  version: "1.0.0",
  lastUpdated: new Date().toISOString(),
  autoUpdateEnabled: true,
  updateIntervalDays: 7,
  mappings: {
    openai: {
      "gpt-5-mini": "gpt-4o-mini",
      "gpt-5.2": "gpt-4o",
      "gpt-5.2-pro": "gpt-4-turbo",
    },
    anthropic: {
      "claude-haiku-4.5": "claude-3-5-haiku-latest",
      "claude-sonnet-4.5": "claude-sonnet-4-20250514",
      "claude-opus-4.5": "claude-3-opus-latest",
    },
    google: {
      "gemini-3-flash": "gemini-2.0-flash",
      "gemini-3-pro": "gemini-1.5-pro",
    },
  },
  availableModels: {
    openai: [],
    anthropic: [],
    google: [],
  },
};

// ============================================================
// 파일 I/O
// ============================================================

export function loadModelMappings(): ModelMappings {
  try {
    if (fs.existsSync(MAPPINGS_FILE)) {
      const data = fs.readFileSync(MAPPINGS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("[ModelMappings] 로드 실패:", error);
  }
  return DEFAULT_MAPPINGS;
}

export function saveModelMappings(mappings: ModelMappings): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
  } catch (error) {
    console.error("[ModelMappings] 저장 실패:", error);
  }
}

// ============================================================
// 모델 ID 변환
// ============================================================

/**
 * 내부 모델 ID를 실제 API 모델 ID로 변환
 */
export function getActualModelId(
  internalId: string,
  provider: "openai" | "anthropic" | "google"
): string {
  const mappings = loadModelMappings();
  const providerMappings = mappings.mappings[provider];
  
  if (providerMappings && providerMappings[internalId]) {
    return providerMappings[internalId];
  }
  
  // 매핑이 없으면 기본값 사용
  const defaults: Record<string, Record<string, string>> = {
    openai: {
      "gpt-5-mini": "gpt-4o-mini",
      "gpt-5.2": "gpt-4o",
      "gpt-5.2-pro": "gpt-4-turbo",
    },
    anthropic: {
      "claude-haiku-4.5": "claude-3-5-haiku-latest",
      "claude-sonnet-4.5": "claude-sonnet-4-20250514",
      "claude-opus-4.5": "claude-3-opus-latest",
    },
    google: {
      "gemini-3-flash": "gemini-2.0-flash",
      "gemini-3-pro": "gemini-1.5-pro",
    },
  };
  
  return defaults[provider]?.[internalId] || internalId;
}

// ============================================================
// 자동 업데이트 체크
// ============================================================

/**
 * 업데이트가 필요한지 확인
 */
export function needsUpdate(): boolean {
  const mappings = loadModelMappings();
  
  if (!mappings.autoUpdateEnabled) {
    return false;
  }
  
  const lastUpdated = new Date(mappings.lastUpdated);
  const now = new Date();
  const daysSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  
  return daysSinceUpdate >= mappings.updateIntervalDays;
}

// ============================================================
// API 모델 목록 조회
// ============================================================

/**
 * OpenAI 모델 목록 조회
 */
export async function fetchOpenAIModels(apiKey: string): Promise<ModelUpdateResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    
    if (!res.ok) {
      return { success: false, provider: "openai", error: `HTTP ${res.status}` };
    }
    
    const data = await res.json();
    const models = data.data
      .map((m: any) => m.id)
      .filter((id: string) => 
        id.startsWith("gpt-4") || id.startsWith("gpt-3.5") || id.startsWith("o1")
      )
      .sort();
    
    return { success: true, provider: "openai", models };
  } catch (error: any) {
    return { success: false, provider: "openai", error: error.message };
  }
}

/**
 * Anthropic 모델 목록 조회
 */
export async function fetchAnthropicModels(apiKey: string): Promise<ModelUpdateResult> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    
    if (!res.ok) {
      // Anthropic API가 모델 목록을 지원하지 않는 경우 하드코딩된 목록 반환
      return {
        success: true,
        provider: "anthropic",
        models: [
          "claude-sonnet-4-20250514",
          "claude-3-5-sonnet-20241022",
          "claude-3-5-haiku-latest",
          "claude-3-5-haiku-20241022",
          "claude-3-opus-latest",
          "claude-3-opus-20240229",
          "claude-3-haiku-20240307",
        ],
      };
    }
    
    const data = await res.json();
    const models = data.data?.map((m: any) => m.id) || [];
    
    return { success: true, provider: "anthropic", models };
  } catch (error: any) {
    // 오류 시에도 기본 목록 반환
    return {
      success: true,
      provider: "anthropic",
      models: [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest",
      ],
    };
  }
}

/**
 * Google 모델 목록 조회
 */
export async function fetchGoogleModels(apiKey: string): Promise<ModelUpdateResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );
    
    if (!res.ok) {
      return { success: false, provider: "google", error: `HTTP ${res.status}` };
    }
    
    const data = await res.json();
    const models = data.models
      ?.map((m: any) => m.name?.replace("models/", ""))
      .filter((id: string) => id?.startsWith("gemini"))
      .sort() || [];
    
    return { success: true, provider: "google", models };
  } catch (error: any) {
    return { success: false, provider: "google", error: error.message };
  }
}

// ============================================================
// 매핑 자동 업데이트
// ============================================================

/**
 * 사용 가능한 모델 중 최적 모델 선택
 */
function selectBestModel(
  internalId: string,
  availableModels: string[],
  provider: string
): string | null {
  if (availableModels.length === 0) return null;
  
  // 내부 ID에 따른 선호 모델 패턴
  const preferences: Record<string, Record<string, string[]>> = {
    openai: {
      "gpt-5-mini": ["gpt-4o-mini", "gpt-3.5-turbo"],
      "gpt-5.2": ["gpt-4o", "gpt-4-turbo", "gpt-4"],
      "gpt-5.2-pro": ["gpt-4-turbo", "gpt-4o", "o1-mini"],
    },
    anthropic: {
      "claude-haiku-4.5": ["claude-3-5-haiku-latest", "claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
      "claude-sonnet-4.5": ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-sonnet-latest"],
      "claude-opus-4.5": ["claude-3-opus-latest", "claude-3-opus-20240229"],
    },
    google: {
      "gemini-3-flash": ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"],
      "gemini-3-pro": ["gemini-1.5-pro", "gemini-1.5-pro-latest", "gemini-1.0-pro"],
    },
  };
  
  const prefs = preferences[provider]?.[internalId] || [];
  
  for (const pref of prefs) {
    if (availableModels.includes(pref)) {
      return pref;
    }
    // 부분 일치 검색
    const match = availableModels.find(m => m.includes(pref) || pref.includes(m));
    if (match) return match;
  }
  
  return null;
}

/**
 * 모델 매핑 자동 업데이트
 */
export async function updateModelMappings(apiKeys: {
  openai?: string;
  anthropic?: string;
  google?: string;
}): Promise<{
  success: boolean;
  updated: string[];
  errors: string[];
}> {
  const mappings = loadModelMappings();
  const updated: string[] = [];
  const errors: string[] = [];
  
  // OpenAI
  if (apiKeys.openai) {
    const result = await fetchOpenAIModels(apiKeys.openai);
    if (result.success && result.models) {
      mappings.availableModels.openai = result.models;
      
      // 매핑 업데이트
      for (const internalId of Object.keys(mappings.mappings.openai)) {
        const best = selectBestModel(internalId, result.models, "openai");
        if (best) {
          mappings.mappings.openai[internalId] = best;
        }
      }
      updated.push("openai");
    } else if (result.error) {
      errors.push(`OpenAI: ${result.error}`);
    }
  }
  
  // Anthropic
  if (apiKeys.anthropic) {
    const result = await fetchAnthropicModels(apiKeys.anthropic);
    if (result.success && result.models) {
      mappings.availableModels.anthropic = result.models;
      
      // 매핑 업데이트
      for (const internalId of Object.keys(mappings.mappings.anthropic)) {
        const best = selectBestModel(internalId, result.models, "anthropic");
        if (best) {
          mappings.mappings.anthropic[internalId] = best;
        }
      }
      updated.push("anthropic");
    } else if (result.error) {
      errors.push(`Anthropic: ${result.error}`);
    }
  }
  
  // Google
  if (apiKeys.google) {
    const result = await fetchGoogleModels(apiKeys.google);
    if (result.success && result.models) {
      mappings.availableModels.google = result.models;
      
      // 매핑 업데이트
      for (const internalId of Object.keys(mappings.mappings.google)) {
        const best = selectBestModel(internalId, result.models, "google");
        if (best) {
          mappings.mappings.google[internalId] = best;
        }
      }
      updated.push("google");
    } else if (result.error) {
      errors.push(`Google: ${result.error}`);
    }
  }
  
  // 업데이트 시간 갱신
  mappings.lastUpdated = new Date().toISOString();
  saveModelMappings(mappings);
  
  return {
    success: errors.length === 0,
    updated,
    errors,
  };
}

/**
 * 자동 업데이트 설정 변경
 */
export function setAutoUpdate(enabled: boolean, intervalDays?: number): void {
  const mappings = loadModelMappings();
  mappings.autoUpdateEnabled = enabled;
  if (intervalDays !== undefined) {
    mappings.updateIntervalDays = intervalDays;
  }
  saveModelMappings(mappings);
}

/**
 * 특정 프로바이더의 매핑 수동 설정
 */
export function setModelMapping(
  provider: "openai" | "anthropic" | "google",
  internalId: string,
  actualId: string
): void {
  const mappings = loadModelMappings();
  mappings.mappings[provider][internalId] = actualId;
  saveModelMappings(mappings);
}
