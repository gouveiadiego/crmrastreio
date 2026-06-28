#!/bin/sh
# Só faz o build se ainda não existe o servidor standalone.
# Isso evita rebuild desnecessário quando o container reinicia por OOM.
if [ ! -f ".next/standalone/server.js" ]; then
  echo "[start.sh] Build não encontrado. Compilando..."
  npm run build && \
    cp -r .next/static .next/standalone/.next/static && \
    cp -r public .next/standalone/public
fi

echo "[start.sh] Iniciando servidor..."
node .next/standalone/server.js
