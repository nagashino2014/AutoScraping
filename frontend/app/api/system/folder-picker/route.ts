/**
 * 폴더 선택 대화상자 API
 * 
 * Windows의 폴더 선택 대화상자를 띄워서 전체 경로를 반환합니다.
 */

import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { title = "폴더를 선택하세요", initialPath = "" } = body;

    // PowerShell 스크립트: Windows Forms 폴더 선택 대화상자
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
$folderBrowser.Description = "${title.replace(/"/g, '`"')}"
$folderBrowser.ShowNewFolderButton = $true
${initialPath ? `$folderBrowser.SelectedPath = "${initialPath.replace(/\\/g, "\\\\").replace(/"/g, '`"')}"` : ""}
$result = $folderBrowser.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $folderBrowser.SelectedPath
} else {
    Write-Output "__CANCELLED__"
}
`.trim();

    // PowerShell 실행
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`,
      { timeout: 60000 } // 60초 타임아웃
    );

    const selectedPath = stdout.trim();

    if (stderr) {
      console.error("[folder-picker] PowerShell stderr:", stderr);
    }

    if (selectedPath === "__CANCELLED__" || !selectedPath) {
      return NextResponse.json({ 
        success: false, 
        cancelled: true,
        path: null 
      });
    }

    return NextResponse.json({ 
      success: true, 
      cancelled: false,
      path: selectedPath 
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[folder-picker] Error:", errorMsg);
    
    return NextResponse.json(
      { 
        success: false, 
        cancelled: false,
        error: errorMsg 
      },
      { status: 500 }
    );
  }
}
