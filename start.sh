#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "==============================================="
echo "  Painel Selfbot Cloner — Instalador (Node.js)"
echo "==============================================="

echo "[1/3] Verificando Node.js..."
node --version

echo "[2/3] Instalando dependências (npm install)..."
npm install --no-audit --no-fund

echo "[3/3] Verificando .env..."
if [ ! -f ".env" ]; then
    echo "[ERRO] Crie o arquivo .env com BOT_TOKEN=..."
    exit 1
fi

echo "[INFO] Iniciando painel..."
exec node index.js
