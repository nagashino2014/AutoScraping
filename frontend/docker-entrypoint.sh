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
  # 복사된 파일의 소유권도 nextjs로 설정
  chown -R nextjs:nodejs /app/data 2>/dev/null || true
  echo "[Init] 데이터 초기화 완료"
fi

# nextjs 사용자로 서버 시작
exec su -s /bin/sh nextjs -c "node server.js"
