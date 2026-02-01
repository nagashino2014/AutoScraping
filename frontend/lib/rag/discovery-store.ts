/**
 * 이슈 발굴 세션 관리 스토어
 * 
 * RAG 분석 세션, 발굴된 이슈, 사용자 선택 상태를 관리
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// ============================================================
// 타입 정의
// ============================================================

/** 이슈 상태 */
export type IssueStatus = "discovered" | "selected" | "rejected" | "analyzed";

/** 분석 세션 상태 */
export type SessionStatus = "filtering" | "discovering" | "completed" | "error";

/** 중요도 점수 구성 */
export interface ImportanceScore {
  total: number;              // 종합 점수 (0~1)
  legalMandatory: number;     // 법적 강제성
  novelty: number;            // 신규성
  impact: number;             // 파급력
  international: number;      // 국제 동향
}

/** 발굴된 이슈 */
export interface DiscoveredIssue {
  id: string;
  sessionId: string;
  
  // 기본 정보
  title: string;
  summary: string;
  keywords: string[];
  
  // 클러스터 정보
  clusterId: number;
  clusterSize: number;
  representativeChunkIds: string[];
  
  // 중요도 점수
  score: ImportanceScore;
  
  // 상태
  status: IssueStatus;
  
  // 사용자 수정
  userTitle?: string;
  userSummary?: string;
  userNotes?: string;
  
  // 메타데이터
  sources: {
    orgName: string;
    boardName: string;
    dateFolder: string;
    docTitle?: string;
  }[];
  
  createdAt: string;
  updatedAt: string;
}

/** 필터 설정 */
export interface FilterConfig {
  dateRange?: {
    start: string;
    end: string;
  };
  organizations?: string[];
  boards?: string[];
  chunkTypes?: string[];
}

/** 발굴 설정 */
export interface DiscoveryConfig {
  numIssues: number;           // 발굴할 이슈 수
  clusteringAlgorithm: "kmeans" | "hdbscan";
  numClusters: number;
  minClusterSize: number;
  scoreWeights: {
    legalMandatory: number;
    novelty: number;
    impact: number;
    international: number;
  };
}

/** 분석 세션 */
export interface DiscoverySession {
  id: string;
  name: string;
  
  // 상태
  status: SessionStatus;
  progress: number;            // 0~100
  currentStep: string;
  
  // 필터 설정
  filter: FilterConfig;
  filteredChunkCount: number;
  
  // 발굴 설정
  config: DiscoveryConfig;
  
  // 발굴 결과
  issues: DiscoveredIssue[];
  selectedIssueIds: string[];
  
  // 메타데이터
  llmModel: string;
  tokenUsage: {
    input: number;
    output: number;
    cost: number;
  };
  
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // 에러 정보
  errorMessage?: string;
}

/** 세션 목록 아이템 */
export interface SessionListItem {
  id: string;
  name: string;
  status: SessionStatus;
  issueCount: number;
  selectedCount: number;
  createdAt: string;
}

// ============================================================
// 기본값
// ============================================================

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  numIssues: 10,
  clusteringAlgorithm: "kmeans",
  numClusters: 15,
  minClusterSize: 5,
  scoreWeights: {
    legalMandatory: 0.40,
    novelty: 0.25,
    impact: 0.20,
    international: 0.15,
  },
};

// ============================================================
// 파일 경로
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_DIR = path.join(DATA_DIR, "rag-sessions");

// 디렉토리 생성
function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// ============================================================
// 세션 CRUD
// ============================================================

/**
 * 새 세션 생성
 */
export function createSession(
  name: string,
  filter: FilterConfig,
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG
): DiscoverySession {
  ensureDirectories();
  
  const session: DiscoverySession = {
    id: randomUUID(),
    name,
    status: "filtering",
    progress: 0,
    currentStep: "초기화",
    filter,
    filteredChunkCount: 0,
    config,
    issues: [],
    selectedIssueIds: [],
    llmModel: "",
    tokenUsage: { input: 0, output: 0, cost: 0 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  saveSession(session);
  return session;
}

/**
 * 세션 저장
 */
export function saveSession(session: DiscoverySession): void {
  ensureDirectories();
  
  const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * 세션 로드
 */
export function loadSession(sessionId: string): DiscoverySession | null {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Failed to load session ${sessionId}:`, error);
  }
  
  return null;
}

/**
 * 세션 삭제
 */
export function deleteSession(sessionId: string): boolean {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete session ${sessionId}:`, error);
  }
  
  return false;
}

/**
 * 모든 세션 목록 조회
 */
export function listSessions(): SessionListItem[] {
  ensureDirectories();
  
  const sessions: SessionListItem[] = [];
  
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      
      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const session: DiscoverySession = JSON.parse(data);
        
        sessions.push({
          id: session.id,
          name: session.name,
          status: session.status,
          issueCount: session.issues.length,
          selectedCount: session.selectedIssueIds.length,
          createdAt: session.createdAt,
        });
      } catch {
        // 파일 파싱 실패 무시
      }
    }
  } catch (error) {
    console.error("Failed to list sessions:", error);
  }
  
  // 최신순 정렬
  sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return sessions;
}

// ============================================================
// 세션 상태 업데이트
// ============================================================

/**
 * 세션 진행 상황 업데이트
 */
export function updateSessionProgress(
  sessionId: string,
  progress: number,
  currentStep: string,
  status?: SessionStatus
): void {
  const session = loadSession(sessionId);
  if (!session) return;
  
  session.progress = progress;
  session.currentStep = currentStep;
  if (status) session.status = status;
  
  saveSession(session);
}

/**
 * 세션에 이슈 추가
 */
export function addIssuesToSession(
  sessionId: string,
  issues: Omit<DiscoveredIssue, "id" | "sessionId" | "createdAt" | "updatedAt">[]
): DiscoveredIssue[] {
  const session = loadSession(sessionId);
  if (!session) return [];
  
  const newIssues: DiscoveredIssue[] = issues.map((issue) => ({
    ...issue,
    id: randomUUID(),
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  
  session.issues.push(...newIssues);
  saveSession(session);
  
  return newIssues;
}

/**
 * 세션 완료 처리
 */
export function completeSession(
  sessionId: string,
  tokenUsage: { input: number; output: number; cost: number },
  llmModel: string
): void {
  const session = loadSession(sessionId);
  if (!session) return;
  
  session.status = "completed";
  session.progress = 100;
  session.currentStep = "완료";
  session.completedAt = new Date().toISOString();
  session.tokenUsage = tokenUsage;
  session.llmModel = llmModel;
  
  saveSession(session);
}

/**
 * 세션 에러 처리
 */
export function failSession(sessionId: string, errorMessage: string): void {
  const session = loadSession(sessionId);
  if (!session) return;
  
  session.status = "error";
  session.errorMessage = errorMessage;
  
  saveSession(session);
}

// ============================================================
// 이슈 관리
// ============================================================

/**
 * 이슈 상태 업데이트
 */
export function updateIssueStatus(
  sessionId: string,
  issueId: string,
  status: IssueStatus
): DiscoveredIssue | null {
  const session = loadSession(sessionId);
  if (!session) return null;
  
  const issue = session.issues.find((i) => i.id === issueId);
  if (!issue) return null;
  
  issue.status = status;
  issue.updatedAt = new Date().toISOString();
  
  // 선택 상태 업데이트
  if (status === "selected") {
    if (!session.selectedIssueIds.includes(issueId)) {
      session.selectedIssueIds.push(issueId);
    }
  } else {
    session.selectedIssueIds = session.selectedIssueIds.filter((id) => id !== issueId);
  }
  
  saveSession(session);
  return issue;
}

/**
 * 이슈 내용 수정
 */
export function updateIssueContent(
  sessionId: string,
  issueId: string,
  updates: {
    userTitle?: string;
    userSummary?: string;
    userNotes?: string;
  }
): DiscoveredIssue | null {
  const session = loadSession(sessionId);
  if (!session) return null;
  
  const issue = session.issues.find((i) => i.id === issueId);
  if (!issue) return null;
  
  if (updates.userTitle !== undefined) issue.userTitle = updates.userTitle;
  if (updates.userSummary !== undefined) issue.userSummary = updates.userSummary;
  if (updates.userNotes !== undefined) issue.userNotes = updates.userNotes;
  issue.updatedAt = new Date().toISOString();
  
  saveSession(session);
  return issue;
}

/**
 * 선택된 이슈 일괄 업데이트
 */
export function selectIssues(sessionId: string, issueIds: string[]): void {
  const session = loadSession(sessionId);
  if (!session) return;
  
  // 모든 이슈 상태 초기화
  for (const issue of session.issues) {
    if (issueIds.includes(issue.id)) {
      issue.status = "selected";
    } else if (issue.status === "selected") {
      issue.status = "discovered";
    }
    issue.updatedAt = new Date().toISOString();
  }
  
  session.selectedIssueIds = issueIds;
  saveSession(session);
}

/**
 * 세션의 선택된 이슈 조회
 */
export function getSelectedIssues(sessionId: string): DiscoveredIssue[] {
  const session = loadSession(sessionId);
  if (!session) return [];
  
  return session.issues.filter((issue) => 
    session.selectedIssueIds.includes(issue.id)
  );
}
