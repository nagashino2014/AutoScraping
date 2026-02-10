/**
 * 심층 분석 결과 저장 스토어
 * 
 * 분석 세션과 결과를 관리합니다.
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// ============================================================
// 타입 정의
// ============================================================

/** 분석 단계 결과 */
export interface AnalysisStepResult {
  stepId: string;
  stepName: string;
  method: string;
  content: string;
  sources: string[];
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

/** 이슈별 분석 결과 */
export interface IssueAnalysisResult {
  issueId: string;
  issueTitle: string;
  steps: AnalysisStepResult[];
  summary: string;
  recommendations: string[];
  completedAt: string;
}

/** 분석 세션 */
export interface AnalysisSession {
  id: string;
  discoverySessionId: string;  // 연관된 발굴 세션
  name: string;
  
  // 설정
  config: {
    depth: "quick" | "standard" | "deep";
    includeEvidence: boolean;
    includeRecommendation: boolean;
    maxSteps: number;
  };
  
  // 결과
  results: IssueAnalysisResult[];
  
  // 메타데이터
  model: string;
  tokenUsage: {
    input: number;
    output: number;
    cost: number;
  };
  
  status: "running" | "completed" | "error";
  errorMessage?: string;
  
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

/** 세션 목록 아이템 */
export interface AnalysisSessionListItem {
  id: string;
  discoverySessionId: string;
  name: string;
  status: "running" | "completed" | "error";
  issueCount: number;
  model: string;
  totalCost: number;
  createdAt: string;
}

// ============================================================
// 파일 경로
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const ANALYSIS_DIR = path.join(DATA_DIR, "rag-analysis");

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ANALYSIS_DIR)) {
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  }
}

// ============================================================
// 세션 CRUD
// ============================================================

/**
 * 새 분석 세션 생성
 */
export function createAnalysisSession(
  discoverySessionId: string,
  name: string,
  config: AnalysisSession["config"]
): AnalysisSession {
  ensureDirectories();
  
  const session: AnalysisSession = {
    id: randomUUID(),
    discoverySessionId,
    name,
    config,
    results: [],
    model: "",
    tokenUsage: { input: 0, output: 0, cost: 0 },
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  saveAnalysisSession(session);
  return session;
}

/**
 * 세션 저장
 */
export function saveAnalysisSession(session: AnalysisSession): void {
  ensureDirectories();
  
  const filePath = path.join(ANALYSIS_DIR, `${session.id}.json`);
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * 세션 로드
 */
export function loadAnalysisSession(sessionId: string): AnalysisSession | null {
  const filePath = path.join(ANALYSIS_DIR, `${sessionId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Failed to load analysis session ${sessionId}:`, error);
  }
  
  return null;
}

/**
 * 세션 삭제
 */
export function deleteAnalysisSession(sessionId: string): boolean {
  const filePath = path.join(ANALYSIS_DIR, `${sessionId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete analysis session ${sessionId}:`, error);
  }
  
  return false;
}

/**
 * 모든 분석 세션 목록 조회
 */
export function listAnalysisSessions(): AnalysisSessionListItem[] {
  ensureDirectories();
  
  const sessions: AnalysisSessionListItem[] = [];
  
  try {
    const files = fs.readdirSync(ANALYSIS_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      const filePath = path.join(ANALYSIS_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const session: AnalysisSession = JSON.parse(data);
        
        sessions.push({
          id: session.id,
          discoverySessionId: session.discoverySessionId,
          name: session.name,
          status: session.status,
          issueCount: session.results.length,
          model: session.model,
          totalCost: session.tokenUsage.cost,
          createdAt: session.createdAt,
        });
      } catch {
        // 파일 파싱 실패 무시
      }
    }
  } catch (error) {
    console.error("Failed to list analysis sessions:", error);
  }
  
  // 최신순 정렬
  sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return sessions;
}

/**
 * 발굴 세션 ID로 분석 세션 조회
 */
export function getAnalysisSessionByDiscoveryId(discoverySessionId: string): AnalysisSession | null {
  ensureDirectories();
  
  try {
    const files = fs.readdirSync(ANALYSIS_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      const filePath = path.join(ANALYSIS_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const session: AnalysisSession = JSON.parse(data);
        
        if (session.discoverySessionId === discoverySessionId) {
          return session;
        }
      } catch {
        // 파싱 실패 무시
      }
    }
  } catch (error) {
    console.error("Failed to find analysis session:", error);
  }
  
  return null;
}

// ============================================================
// 세션 업데이트 함수
// ============================================================

/**
 * 이슈 분석 결과 추가
 */
export function addIssueResult(
  sessionId: string,
  result: IssueAnalysisResult
): void {
  const session = loadAnalysisSession(sessionId);
  if (!session) return;
  
  // 기존 결과가 있으면 업데이트, 없으면 추가
  const existingIndex = session.results.findIndex(r => r.issueId === result.issueId);
  if (existingIndex >= 0) {
    session.results[existingIndex] = result;
  } else {
    session.results.push(result);
  }
  
  saveAnalysisSession(session);
}

/**
 * 분석 단계 결과 추가
 */
export function addStepResult(
  sessionId: string,
  issueId: string,
  stepResult: AnalysisStepResult
): void {
  const session = loadAnalysisSession(sessionId);
  if (!session) return;
  
  let issueResult = session.results.find(r => r.issueId === issueId);
  
  if (!issueResult) {
    issueResult = {
      issueId,
      issueTitle: "",
      steps: [],
      summary: "",
      recommendations: [],
      completedAt: "",
    };
    session.results.push(issueResult);
  }
  
  // 기존 단계가 있으면 업데이트, 없으면 추가
  const existingStepIndex = issueResult.steps.findIndex(
    s => s.stepId === stepResult.stepId
  );
  if (existingStepIndex >= 0) {
    issueResult.steps[existingStepIndex] = stepResult;
  } else {
    issueResult.steps.push(stepResult);
  }
  
  // 토큰 사용량 업데이트
  session.tokenUsage.input += stepResult.inputTokens;
  session.tokenUsage.output += stepResult.outputTokens;
  
  saveAnalysisSession(session);
}

/**
 * 세션 완료 처리
 */
export function completeAnalysisSession(
  sessionId: string,
  model: string,
  cost: number
): void {
  const session = loadAnalysisSession(sessionId);
  if (!session) return;
  
  session.status = "completed";
  session.model = model;
  session.tokenUsage.cost = cost;
  session.completedAt = new Date().toISOString();
  
  saveAnalysisSession(session);
}

/**
 * 세션 에러 처리
 */
export function failAnalysisSession(sessionId: string, errorMessage: string): void {
  const session = loadAnalysisSession(sessionId);
  if (!session) return;
  
  session.status = "error";
  session.errorMessage = errorMessage;
  
  saveAnalysisSession(session);
}
