import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// ============================================================
// 타입 정의
// ============================================================

type FolderStructure = "flat" | "by_org" | "by_org_board" | "by_org_board_date" | "by_date_org_board";
type DuplicateHandling = "skip" | "overwrite" | "version";
type FailureAction = "skip" | "log_only" | "stop";

// 파일명 규칙 타입
type DocFileNameRule = "simple" | "board_prefix" | "date_board" | "datetime_board";
type AttachmentFileNameRule = "original" | "date_prefix" | "datetime_prefix";

// 정규 스크래핑용 경로 (스케줄 기반) - 공통 경로 + 파일명 규칙만 분리
interface PathSettings {
  basePath: string;
  folderStructure: FolderStructure;
  docFileNameRule: DocFileNameRule;
  attachmentFileNameRule: AttachmentFileNameRule;
}

// 스크래핑 테스트용 경로 (즉시 실행) - 단순 경로만
interface TestPathSettings {
  documentsPath: string;
  attachmentsPath: string;
}

interface RetrySettings {
  maxRetries: number;
  retryIntervalSec: number;
  useExponentialBackoff: boolean;
  timeoutSec: number;
  failureAction: FailureAction;
}

interface FileManagementSettings {
  maxFileSizeMb: number;
  duplicateHandling: DuplicateHandling;
  allowedExtensions: string[];
  concurrentDownloads: number;
}

interface NetworkSettings {
  skipSslVerification: boolean;
  customUserAgent: string;
  proxyUrl: string;
  autoReferer: boolean;
}

interface StorageSettings {
  warningThresholdGb: number;
  autoCleanupEnabled: boolean;
  autoCleanupDays: number;
  maxStorageGb: number;
}

interface DownloadSettings {
  path: PathSettings;
  testPath: TestPathSettings;
  retry: RetrySettings;
  fileManagement: FileManagementSettings;
  network: NetworkSettings;
  storage: StorageSettings;
  updatedAt: string;
}

// ============================================================
// 기본값
// ============================================================

const DEFAULT_SETTINGS: DownloadSettings = {
  path: {
    basePath: "./data/scraping",
    folderStructure: "by_org_board_date",
    docFileNameRule: "simple",
    attachmentFileNameRule: "original",
  },
  testPath: {
    documentsPath: "./data/test/documents",
    attachmentsPath: "./data/test/attachments",
  },
  retry: {
    maxRetries: 3,
    retryIntervalSec: 5,
    useExponentialBackoff: true,
    timeoutSec: 60,
    failureAction: "skip",
  },
  fileManagement: {
    maxFileSizeMb: 100,
    duplicateHandling: "skip",
    allowedExtensions: [],
    concurrentDownloads: 2,
  },
  network: {
    skipSslVerification: false,
    customUserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EcoMonitorBot/1.0",
    proxyUrl: "",
    autoReferer: true,
  },
  storage: {
    warningThresholdGb: 10,
    autoCleanupEnabled: false,
    autoCleanupDays: 365,
    maxStorageGb: 0,
  },
  updatedAt: "",
};

// ============================================================
// 파일 경로
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "download-settings.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

// 마이그레이션: 기존 구조를 새 구조로 변환
function migrateOldSettings(data: any): DownloadSettings {
  // 새 구조 확인 (path에 basePath가 직접 있는지)
  if (data.path && typeof data.path.basePath === "string" && data.path.docFileNameRule) {
    // 이미 새 구조
    return {
      ...DEFAULT_SETTINGS,
      ...data,
      path: { ...DEFAULT_SETTINGS.path, ...data.path },
      testPath: {
        documentsPath: data.testPath?.documentsPath || DEFAULT_SETTINGS.testPath.documentsPath,
        attachmentsPath: data.testPath?.attachmentsPath || DEFAULT_SETTINGS.testPath.attachmentsPath,
      },
      retry: { ...DEFAULT_SETTINGS.retry, ...data.retry },
      fileManagement: { ...DEFAULT_SETTINGS.fileManagement, ...data.fileManagement },
      network: { ...DEFAULT_SETTINGS.network, ...data.network },
      storage: { ...DEFAULT_SETTINGS.storage, ...data.storage },
    };
  }

  // 이전 구조에서 마이그레이션 (path에 documents/attachments 객체가 있는 경우)
  if (data.path && data.path.documents) {
    return {
      ...DEFAULT_SETTINGS,
      path: {
        basePath: data.path.documents?.basePath || data.path.attachments?.basePath || DEFAULT_SETTINGS.path.basePath,
        folderStructure: data.path.documents?.folderStructure || data.path.attachments?.folderStructure || DEFAULT_SETTINGS.path.folderStructure,
        docFileNameRule: data.path.documents?.fileNameRule || DEFAULT_SETTINGS.path.docFileNameRule,
        attachmentFileNameRule: data.path.attachments?.fileNameRule || DEFAULT_SETTINGS.path.attachmentFileNameRule,
      },
      testPath: {
        documentsPath: data.testPath?.documentsPath || data.testPath?.documents?.basePath || DEFAULT_SETTINGS.testPath.documentsPath,
        attachmentsPath: data.testPath?.attachmentsPath || data.testPath?.attachments?.basePath || DEFAULT_SETTINGS.testPath.attachmentsPath,
      },
      retry: { ...DEFAULT_SETTINGS.retry, ...data.retry },
      fileManagement: { ...DEFAULT_SETTINGS.fileManagement, ...data.fileManagement },
      network: { ...DEFAULT_SETTINGS.network, ...data.network },
      storage: { ...DEFAULT_SETTINGS.storage, ...data.storage },
      updatedAt: data.updatedAt || "",
    };
  }
  
  // 아주 오래된 단일 path 구조에서 마이그레이션
  const oldPath = data.path || {};
  if (typeof oldPath.basePath === "string" && !oldPath.docFileNameRule) {
    return {
      ...DEFAULT_SETTINGS,
      path: {
        basePath: oldPath.basePath || DEFAULT_SETTINGS.path.basePath,
        folderStructure: oldPath.folderStructure || DEFAULT_SETTINGS.path.folderStructure,
        docFileNameRule: "simple",
        attachmentFileNameRule: oldPath.fileNameRule === "docid_prefix" ? "original" : (oldPath.fileNameRule || "original"),
      },
      testPath: DEFAULT_SETTINGS.testPath,
      retry: { ...DEFAULT_SETTINGS.retry, ...data.retry },
      fileManagement: { ...DEFAULT_SETTINGS.fileManagement, ...data.fileManagement },
      network: { ...DEFAULT_SETTINGS.network, ...data.network },
      storage: { ...DEFAULT_SETTINGS.storage, ...data.storage },
      updatedAt: data.updatedAt || "",
    };
  }

  return DEFAULT_SETTINGS;
}

async function readSettings(): Promise<DownloadSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    const data = JSON.parse(raw);
    // 마이그레이션 적용
    return migrateOldSettings(data);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function writeSettings(settings: DownloadSettings): Promise<void> {
  await ensureDir();
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

// ============================================================
// GET - 설정 조회
// ============================================================

export async function GET() {
  try {
    const settings = await readSettings();
    return NextResponse.json(settings);
  } catch (err: any) {
    console.error("[download-settings] GET error:", err);
    return NextResponse.json({ error: err.message || "조회 실패" }, { status: 500 });
  }
}

// ============================================================
// PUT - 설정 저장
// ============================================================

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    
    // 기본값과 병합
    const merged: DownloadSettings = {
      path: { ...DEFAULT_SETTINGS.path, ...body.path },
      testPath: {
        documentsPath: body.testPath?.documentsPath || DEFAULT_SETTINGS.testPath.documentsPath,
        attachmentsPath: body.testPath?.attachmentsPath || DEFAULT_SETTINGS.testPath.attachmentsPath,
      },
      retry: { ...DEFAULT_SETTINGS.retry, ...body.retry },
      fileManagement: { ...DEFAULT_SETTINGS.fileManagement, ...body.fileManagement },
      network: { ...DEFAULT_SETTINGS.network, ...body.network },
      storage: { ...DEFAULT_SETTINGS.storage, ...body.storage },
      updatedAt: new Date().toISOString(),
    };
    
    await writeSettings(merged);
    return NextResponse.json({ ok: true, settings: merged });
  } catch (err: any) {
    console.error("[download-settings] PUT error:", err);
    return NextResponse.json({ error: err.message || "저장 실패" }, { status: 500 });
  }
}

// ============================================================
// DELETE - 설정 초기화
// ============================================================

export async function DELETE() {
  try {
    const reset = { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() };
    await writeSettings(reset);
    return NextResponse.json({ ok: true, settings: reset });
  } catch (err: any) {
    console.error("[download-settings] DELETE error:", err);
    return NextResponse.json({ error: err.message || "초기화 실패" }, { status: 500 });
  }
}
