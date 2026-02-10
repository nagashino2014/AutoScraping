#!/bin/sh
# ============================================================
# Docker Entrypoint - 볼륨 권한 수정 및 기본 데이터 복사
# ============================================================

# Railway 볼륨 권한 수정 (볼륨이 root 소유로 마운트됨)
if [ -d "/app/data" ]; then
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
fi
if [ -d "/app/save" ]; then
  chown -R nextjs:nodejs /app/save 2>/dev/null || true
fi
if [ -d "/app/chunk" ]; then
  chown -R nextjs:nodejs /app/chunk 2>/dev/null || true
fi

# /app/data-defaults → /app/data 동기화
# ---------------------------------------------------------------
# Git에서 관리되는 설정 파일: 매 배포마다 최신 버전으로 덮어쓰기
# (Railway 배포 = git push이므로 data-defaults가 항상 최신)
# 런타임 생성 데이터: 볼륨에 없을 때만 초기화
# ---------------------------------------------------------------
if [ -d "/app/data-defaults" ]; then

  # [1] Git 관리 설정 파일 — 항상 최신으로 업데이트
  CONFIG_FILES="scraper-targets.json scraper-schedules.json embedding-settings.json model-mappings.json download-settings.json users.json"
  for cf in $CONFIG_FILES; do
    if [ -f "/app/data-defaults/$cf" ]; then
      cp -f "/app/data-defaults/$cf" "/app/data/$cf"
      echo "[Sync] 설정 파일 업데이트: $cf"
    fi
  done

  # [2] Git 관리 디렉토리 — 항상 최신으로 동기화
  for dir in site-profiles APISet; do
    if [ -d "/app/data-defaults/$dir" ]; then
      mkdir -p "/app/data/$dir"
      cp -rf "/app/data-defaults/$dir/." "/app/data/$dir/"
      echo "[Sync] 설정 디렉토리 업데이트: $dir"
    fi
  done

  # [3] 런타임 생성 데이터 — 볼륨에 없을 때만 초기화
  for file in /app/data-defaults/*; do
    filename=$(basename "$file")
    target="/app/data/$filename"
    # 이미 위에서 처리한 설정 파일/디렉토리는 스킵
    case "$filename" in
      scraper-targets.json|scraper-schedules.json|embedding-settings.json) continue ;;
      model-mappings.json|download-settings.json|users.json) continue ;;
      site-profiles|APISet) continue ;;
    esac
    if [ ! -e "$target" ]; then
      cp -r "$file" "$target"
      echo "[Init] 런타임 데이터 초기화: $filename"
    fi
  done

  # 복사된 파일의 소유권 설정
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
  echo "[Init] 데이터 동기화 완료"
fi

# nextjs 사용자로 서버 시작 (gosu: 환경 변수를 100% 보존하며 사용자 전환)
exec gosu nextjs node server.js
