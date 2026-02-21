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
 * scraper-targets.json 병합 전략:
 *
 * data-defaults(git/Docker 이미지)와 볼륨(런타임) 중 더 최신인 쪽을 기준으로 삼되,
 * 양쪽에만 존재하는 기관/보드는 모두 포함한다.
 *
 * - defaults가 더 최신: git push로 설정이 변경된 경우 → 기존 보드 설정도 defaults로 갱신
 * - 볼륨이 더 최신: Railway UI에서 변경되었으나 git sync 전에 재배포된 경우 → 볼륨 보존
 * - 어느 쪽이든 상대방에만 있는 기관/보드는 추가
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

    const defaultsTime = new Date(defaults.updated_at || 0).getTime();
    const currentTime = new Date(current.updated_at || 0).getTime();
    const defaultsIsNewer = defaultsTime > currentTime;

    const base = defaultsIsNewer ? defaults : current;
    const other = defaultsIsNewer ? current : defaults;
    const baseLabel = defaultsIsNewer ? "defaults" : "volume";

    console.log(`[Merge] 기준: ${baseLabel} (defaults=${new Date(defaultsTime).toISOString()}, volume=${new Date(currentTime).toISOString()})`);

    const baseOrgIds = new Set((base.orgs || []).map((o: { org_id: string }) => o.org_id));
    const baseBoardIds = new Set((base.boards || []).map((b: { board_id: string }) => b.board_id));
    let added = 0;

    for (const org of other.orgs || []) {
      if (!baseOrgIds.has(org.org_id)) {
        base.orgs.push(org);
        added++;
        console.log(`[Merge] 기관 추가 (from ${defaultsIsNewer ? "volume" : "defaults"}): ${org.org_name}`);
      }
    }

    for (const board of other.boards || []) {
      if (!baseBoardIds.has(board.board_id)) {
        base.boards.push(board);
        added++;
        console.log(`[Merge] 보드 추가 (from ${defaultsIsNewer ? "volume" : "defaults"}): ${board.board_name}`);
      }
    }

    base.updated_at = new Date().toISOString();
    fs.writeFileSync(dest, JSON.stringify(base, null, 2), "utf-8");

    if (defaultsIsNewer) {
      console.log(`[Merge] scraper-targets.json: defaults 기준으로 갱신 (+${added}개 볼륨 항목 병합)`);
    } else if (added > 0) {
      console.log(`[Merge] scraper-targets.json: 볼륨 보존, ${added}개 defaults 항목 추가`);
    }
  } catch (e) {
    console.error("[Merge] scraper-targets.json 병합 실패:", e);
  }
}
