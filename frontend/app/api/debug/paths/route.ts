/**
 * 디버그용 API - 경로 확인
 */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const cwd = process.cwd();
  const settingsPath = path.join(cwd, "data", "download-settings.json");
  
  let settingsExists = false;
  let settingsContent = null;
  let testPaths = null;
  
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    settingsExists = true;
    settingsContent = JSON.parse(raw);
    testPaths = settingsContent?.testPath;
  } catch (err) {
    settingsContent = { error: String(err) };
  }
  
  return NextResponse.json({
    cwd,
    settingsPath,
    settingsExists,
    testPaths,
    resolved: testPaths ? {
      documentsPath: path.isAbsolute(testPaths.documentsPath) 
        ? testPaths.documentsPath 
        : path.join(cwd, testPaths.documentsPath),
      attachmentsPath: path.isAbsolute(testPaths.attachmentsPath)
        ? testPaths.attachmentsPath
        : path.join(cwd, testPaths.attachmentsPath),
    } : null,
  });
}
