/**
 * Railway 볼륨 유실 대비 — data-defaults → data 설정 파일 복원
 * Docker entrypoint 와 동일한 역할을 Node.js 레벨에서 이중으로 수행한다.
 *
 * scraper-targets.json은 사용자가 UI에서 수정하는 런타임 데이터이므로
 * 단순 덮어쓰기 대신 **병합(merge)** 전략을 사용한다:
 *   - 볼륨에 파일이 없으면: data-defaults에서 복사
 *   - 볼륨에 파일이 있으면: data-defaults의 새 기관/보드만 추가, 기존 항목 보존
 */

import fs from "node:fs";
import path from "node:path";

export async function ensureConfigFiles() {
  const cwd = process.cwd();
  const dataDefaultsDir = path.join(cwd, "data-defaults");
  if (!fs.existsSync(dataDefaultsDir)) return;

  const dataDir = path.join(cwd, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  await mergeScraperTargets(dataDefaultsDir, dataDir);

  const CONFIG_FILES = [
    "embedding-settings.json",
    "model-mappings.json",
    "download-settings.json",
    "users.json",
  ];

  let restored = 0;
  for (const file of CONFIG_FILES) {
    const src = path.join(dataDefaultsDir, file);
    const dest = path.join(dataDir, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      restored++;
      console.log(`[Sync] 설정 파일 복원: ${file}`);
    }
  }

  const CONFIG_DIRS = ["site-profiles", "APISet"];
  for (const dir of CONFIG_DIRS) {
    const srcDir = path.join(dataDefaultsDir, dir);
    const destDir = path.join(dataDir, dir);
    if (fs.existsSync(srcDir) && !fs.existsSync(destDir)) {
      fs.cpSync(srcDir, destDir, { recursive: true });
      restored++;
      console.log(`[Sync] 설정 디렉토리 복원: ${dir}`);
    }
  }

  if (restored > 0) {
    console.log(`[Sync] ${restored}개 설정 복원 완료`);
  }
}

/**
 * scraper-targets.json 병합: 새 기관/보드만 추가, 기존 항목의 사용자 수정사항 보존
 */
async function mergeScraperTargets(
  dataDefaultsDir: string,
  dataDir: string
) {
  const src = path.join(dataDefaultsDir, "scraper-targets.json");
  const dest = path.join(dataDir, "scraper-targets.json");

  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
    console.log("[Sync] scraper-targets.json 초기 복사 완료");
    return;
  }

  try {
    const defaults = JSON.parse(fs.readFileSync(src, "utf-8"));
    const current = JSON.parse(fs.readFileSync(dest, "utf-8"));

    const currentOrgIds = new Set((current.orgs || []).map((o: { org_id: string }) => o.org_id));
    const currentBoardIds = new Set((current.boards || []).map((b: { board_id: string }) => b.board_id));

    let added = 0;

    for (const org of defaults.orgs || []) {
      if (!currentOrgIds.has(org.org_id)) {
        current.orgs.push(org);
        added++;
        console.log(`[Merge] 새 기관 추가: ${org.org_name} (${org.org_id})`);
      }
    }

    for (const board of defaults.boards || []) {
      if (!currentBoardIds.has(board.board_id)) {
        current.boards.push(board);
        added++;
        console.log(`[Merge] 새 보드 추가: ${board.board_name} (${board.board_id})`);
      }
    }

    if (added > 0) {
      current.updated_at = new Date().toISOString();
      fs.writeFileSync(dest, JSON.stringify(current, null, 2), "utf-8");
      console.log(`[Merge] scraper-targets.json: ${added}개 항목 추가 (기존 설정 보존)`);
    }
  } catch (e) {
    console.error("[Merge] scraper-targets.json 병합 실패:", e);
  }
}
