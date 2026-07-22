#!/bin/sh
set -e

echo "📦 Ejecutando migraciones de base de datos..."
npx prisma migrate deploy

echo "🚀 Iniciando 9Drive MCP Server..."
node dist/index.js --transport "${MCP_TRANSPORT:-sse}"
