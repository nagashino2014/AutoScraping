/**
 * 백그라운드 작업 관리 시스템
 * 
 * 파일 기반 Job Store로 임베딩 등 장시간 작업을 관리합니다.
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

// ============================================================
// 타입 정의
// ============================================================

export type JobType = "embedding" | "chunking" | "analysis";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  currentItem?: string;
  message?: string;
}

export interface JobResult {
  success: boolean;
  processed?: number;
  failed?: number;
  skipped?: number;
  errors?: { id: string; error: string }[];
  data?: any;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  result?: JobResult;
  
  // 작업 파라미터
  params: Record<string, any>;
  
  // 타임스탬프
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  
  // 에러 정보
  error?: string;
  
  // 메타데이터
  metadata?: Record<string, any>;
}

export interface JobListItem {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  createdAt: string;
  completedAt?: string;
}

// ============================================================
// 파일 경로
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const ACTIVE_JOBS_FILE = path.join(JOBS_DIR, "active-jobs.json");

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
  }
}

// ============================================================
// Job CRUD
// ============================================================

/**
 * 새 작업 생성
 */
export function createJob(type: JobType, params: Record<string, any>, metadata?: Record<string, any>): Job {
  ensureDirectories();
  
  const job: Job = {
    id: randomUUID(),
    type,
    status: "pending",
    progress: {
      current: 0,
      total: 0,
      percentage: 0,
    },
    params,
    createdAt: new Date().toISOString(),
    metadata,
  };
  
  saveJob(job);
  addToActiveJobs(job.id);
  
  return job;
}

/**
 * 작업 저장
 */
export function saveJob(job: Job): void {
  ensureDirectories();
  
  const filePath = path.join(JOBS_DIR, `${job.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(job, null, 2), "utf-8");
}

/**
 * 작업 로드
 */
export function loadJob(jobId: string): Job | null {
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Failed to load job ${jobId}:`, error);
  }
  
  return null;
}

/**
 * 작업 삭제
 */
export function deleteJob(jobId: string): boolean {
  const filePath = path.join(JOBS_DIR, `${jobId}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      removeFromActiveJobs(jobId);
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete job ${jobId}:`, error);
  }
  
  return false;
}

// ============================================================
// 활성 작업 관리
// ============================================================

function loadActiveJobs(): string[] {
  try {
    if (fs.existsSync(ACTIVE_JOBS_FILE)) {
      const data = fs.readFileSync(ACTIVE_JOBS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // 무시
  }
  return [];
}

function saveActiveJobs(jobIds: string[]): void {
  ensureDirectories();
  fs.writeFileSync(ACTIVE_JOBS_FILE, JSON.stringify(jobIds, null, 2), "utf-8");
}

function addToActiveJobs(jobId: string): void {
  const activeJobs = loadActiveJobs();
  if (!activeJobs.includes(jobId)) {
    activeJobs.push(jobId);
    saveActiveJobs(activeJobs);
  }
}

function removeFromActiveJobs(jobId: string): void {
  const activeJobs = loadActiveJobs();
  const filtered = activeJobs.filter(id => id !== jobId);
  saveActiveJobs(filtered);
}

// ============================================================
// 작업 상태 업데이트
// ============================================================

/**
 * 작업 시작
 */
export function startJob(jobId: string, total: number): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.progress = {
    current: 0,
    total,
    percentage: 0,
  };
  
  saveJob(job);
  return job;
}

/**
 * 진행률 업데이트
 */
export function updateJobProgress(
  jobId: string,
  current: number,
  currentItem?: string,
  message?: string
): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  
  job.progress.current = current;
  job.progress.percentage = job.progress.total > 0 
    ? Math.round((current / job.progress.total) * 100) 
    : 0;
  job.progress.currentItem = currentItem;
  job.progress.message = message;
  
  saveJob(job);
  return job;
}

/**
 * 작업 완료
 */
export function completeJob(jobId: string, result: JobResult): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  
  job.status = "completed";
  job.completedAt = new Date().toISOString();
  job.progress.current = job.progress.total;
  job.progress.percentage = 100;
  job.result = result;
  
  saveJob(job);
  removeFromActiveJobs(jobId);
  
  return job;
}

/**
 * 작업 실패
 */
export function failJob(jobId: string, error: string, partialResult?: JobResult): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  
  job.status = "failed";
  job.completedAt = new Date().toISOString();
  job.error = error;
  if (partialResult) {
    job.result = partialResult;
  }
  
  saveJob(job);
  removeFromActiveJobs(jobId);
  
  return job;
}

/**
 * 작업 취소
 */
export function cancelJob(jobId: string): Job | null {
  const job = loadJob(jobId);
  if (!job) return null;
  
  // 이미 완료된 작업은 취소 불가
  if (job.status === "completed" || job.status === "failed") {
    return job;
  }
  
  job.status = "cancelled";
  job.completedAt = new Date().toISOString();
  
  saveJob(job);
  removeFromActiveJobs(jobId);
  
  return job;
}

// ============================================================
// 작업 목록 조회
// ============================================================

/**
 * 활성 작업 목록 조회
 */
export function listActiveJobs(): JobListItem[] {
  const activeJobIds = loadActiveJobs();
  const jobs: JobListItem[] = [];
  
  for (const jobId of activeJobIds) {
    const job = loadJob(jobId);
    if (job) {
      jobs.push({
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
      });
    }
  }
  
  return jobs;
}

/**
 * 타입별 작업 목록 조회
 */
export function listJobsByType(type: JobType, limit = 10): JobListItem[] {
  ensureDirectories();
  
  const jobs: JobListItem[] = [];
  
  try {
    const files = fs.readdirSync(JOBS_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json") || file === "active-jobs.json") continue;
      
      const filePath = path.join(JOBS_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const job: Job = JSON.parse(data);
        
        if (job.type === type) {
          jobs.push({
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
          });
        }
      } catch {
        // 파싱 실패 무시
      }
    }
  } catch (error) {
    console.error("Failed to list jobs:", error);
  }
  
  // 최신순 정렬
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return jobs.slice(0, limit);
}

/**
 * 실행 중인 작업 확인
 */
export function hasRunningJob(type: JobType): boolean {
  const activeJobs = listActiveJobs();
  return activeJobs.some(job => job.type === type && job.status === "running");
}

/**
 * 오래된 완료 작업 정리
 */
export function cleanupOldJobs(maxAgeDays = 7): number {
  ensureDirectories();
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
  
  let deletedCount = 0;
  
  try {
    const files = fs.readdirSync(JOBS_DIR);
    
    for (const file of files) {
      if (!file.endsWith(".json") || file === "active-jobs.json") continue;
      
      const filePath = path.join(JOBS_DIR, file);
      try {
        const data = fs.readFileSync(filePath, "utf-8");
        const job: Job = JSON.parse(data);
        
        // 완료된 작업 중 오래된 것만 삭제
        if (
          (job.status === "completed" || job.status === "failed" || job.status === "cancelled") &&
          job.completedAt &&
          new Date(job.completedAt) < cutoffDate
        ) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch {
        // 무시
      }
    }
  } catch (error) {
    console.error("Failed to cleanup jobs:", error);
  }
  
  return deletedCount;
}
