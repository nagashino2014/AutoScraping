@echo off
cd /d "C:\CodingProject\Web Scraper Final\frontend"
echo [%date% %time%] GitHub Artifact ????????
call npx ts-node scripts/sync-from-github.ts
echo [%date% %time%] ???????? (Exit code: %ERRORLEVEL%)
exit /b %ERRORLEVEL%
