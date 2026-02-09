#!/bin/sh
# ============================================================
# Docker Entrypoint - 볼륨 초기화 시 기본 데이터 복사
# ============================================================

# /app/data 볼륨이 비어있으면 기본 데이터를 복사
if [ -d "/app/data-defaults" ]; then
  for file in /app/data-defaults/*; do
    filename=$(basename "$file")
    target="/app/data/$filename"
    if [ ! -e "$target" ]; then
      cp -r "$file" "$target"
      echo "[Init] 기본 데이터 복사: $filename"
    fi
  done
  echo "[Init] 데이터 초기화 완료"
fi

# Next.js 서버 시작
exec node server.js
