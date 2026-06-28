#!/bin/sh
# Compara o commit atual com o commit do último build.
# - Novo deploy (commit diferente) → rebuilda com as env vars corretas
# - Restart após crash/OOM (mesmo commit) → pula build e inicia direto
CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
BUILT_COMMIT=$(cat .next/BUILD_COMMIT 2>/dev/null || echo "none")

if [ "$CURRENT_COMMIT" != "$BUILT_COMMIT" ] || [ ! -f ".next/standalone/server.js" ]; then
  echo "[start.sh] Novo código detectado ($CURRENT_COMMIT). Compilando..."
  npm run build && \
    cp -r .next/static .next/standalone/.next/static && \
    cp -r public .next/standalone/public && \
    echo "$CURRENT_COMMIT" > .next/BUILD_COMMIT
  echo "[start.sh] Build concluído."
else
  echo "[start.sh] Build atualizado (commit $CURRENT_COMMIT). Pulando compilação."
fi

echo "[start.sh] Iniciando servidor..."
node .next/standalone/server.js
