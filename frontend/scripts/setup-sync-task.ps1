# Windows 작업 스케줄러 설정 스크립트
# 
# GitHub Actions Artifact 동기화를 자동으로 실행하도록 Windows 작업 스케줄러에 등록합니다.
#
# 사용법:
#   powershell -ExecutionPolicy Bypass -File setup-sync-task.ps1
#
# 관리자 권한이 필요합니다.

param(
    [string]$TaskName = "WebScraper-GitHub-Sync",
    [string]$Hour = "09",
    [string]$Minute = "00",
    [switch]$Remove,
    [switch]$RunNow
)

# 색상 출력 함수
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-Output ""
Write-Output "========================================"
Write-Output "  GitHub Artifact 동기화 작업 설정"
Write-Output "========================================"
Write-Output ""

# 프로젝트 경로 확인
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Split-Path -Parent $ScriptDir
$ProjectDir = Split-Path -Parent $FrontendDir

Write-Output "프로젝트 경로: $FrontendDir"

# 기존 작업 제거
if ($Remove) {
    Write-Output "기존 작업 제거 중: $TaskName"
    
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-ColorOutput Green "작업이 제거되었습니다."
    } else {
        Write-Output "제거할 작업이 없습니다."
    }
    
    exit 0
}

# Node.js 경로 확인
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    Write-ColorOutput Red "Node.js를 찾을 수 없습니다. Node.js를 설치해주세요."
    exit 1
}

Write-Output "Node.js 경로: $NodePath"

# npx 경로 확인
$NpxPath = (Get-Command npx -ErrorAction SilentlyContinue).Source
if (-not $NpxPath) {
    # npm 경로에서 npx 찾기
    $NpmDir = Split-Path -Parent $NodePath
    $NpxPath = Join-Path $NpmDir "npx.cmd"
    if (-not (Test-Path $NpxPath)) {
        Write-ColorOutput Red "npx를 찾을 수 없습니다."
        exit 1
    }
}

Write-Output "npx 경로: $NpxPath"

# 배치 파일 생성 (작업 스케줄러에서 실행할 파일)
$BatchFile = Join-Path $ScriptDir "run-sync.bat"
$BatchContent = @"
@echo off
cd /d "$FrontendDir"
echo [%date% %time%] GitHub Artifact 동기화 시작
call npx ts-node scripts/sync-from-github.ts
echo [%date% %time%] 동기화 완료 (Exit code: %ERRORLEVEL%)
exit /b %ERRORLEVEL%
"@

Set-Content -Path $BatchFile -Value $BatchContent -Encoding ASCII
Write-Output "배치 파일 생성: $BatchFile"

# 기존 작업 확인 및 제거
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Output "기존 작업 업데이트 중..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# 작업 스케줄러 등록
Write-Output ""
Write-Output "작업 스케줄러에 등록 중..."
Write-Output "  작업 이름: $TaskName"
Write-Output "  실행 시간: 매일 ${Hour}:${Minute}"

# 트리거 설정 (매일 지정 시간)
$Trigger = New-ScheduledTaskTrigger -Daily -At "${Hour}:${Minute}"

# 액션 설정
$Action = New-ScheduledTaskAction -Execute $BatchFile -WorkingDirectory $FrontendDir

# 설정
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# 현재 사용자로 실행 (로그온 시)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Trigger $Trigger `
        -Action $Action `
        -Settings $Settings `
        -Principal $Principal `
        -Description "GitHub Actions에서 생성된 스크래핑 결과를 로컬로 동기화합니다." `
        -Force | Out-Null
    
    Write-Output ""
    Write-ColorOutput Green "작업이 성공적으로 등록되었습니다!"
    
} catch {
    Write-ColorOutput Red "작업 등록 실패: $_"
    exit 1
}

# 즉시 실행 옵션
if ($RunNow) {
    Write-Output ""
    Write-Output "작업을 즉시 실행합니다..."
    Start-ScheduledTask -TaskName $TaskName
    Write-Output "작업이 시작되었습니다."
}

# 안내 메시지
Write-Output ""
Write-Output "========================================"
Write-Output "  설정 완료"
Write-Output "========================================"
Write-Output ""
Write-Output "작업 스케줄러에서 '$TaskName' 작업을 확인하세요."
Write-Output ""
Write-Output "관리 명령어:"
Write-Output "  - 작업 확인: Get-ScheduledTask -TaskName '$TaskName'"
Write-Output "  - 수동 실행: Start-ScheduledTask -TaskName '$TaskName'"
Write-Output "  - 작업 제거: .\setup-sync-task.ps1 -Remove"
Write-Output ""
Write-Output "중요: .env.local 파일에 다음 환경 변수가 설정되어 있어야 합니다:"
Write-Output "  GITHUB_TOKEN=ghp_xxxxxxxxxxxx"
Write-Output "  GITHUB_REPO=username/repository-name"
Write-Output ""
