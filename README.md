# 9Drive + MCP Server

Fork self-hosted de [9Drive](https://github.com/zenhosta/9drive) con **servidor MCP integrado** que permite a un LLM (Claude, Kiro, GPT) gestionar tu almacenamiento en la nube directamente.

## Arquitectura (Opcion C: Acceso directo a DB/APIs)

```
┌──────────────────────────────────────────────────────────┐
│                    TU SERVIDOR                            │
├────────────────┬─────────────────┬───────────────────────┤
│  frontend/     │   backend/      │   mcp-server/         │
│  React + Vite  │ Express + REST  │  MCP Protocol         │
│  (UI web)      │ (API HTTP)      │  (stdio / SSE)        │
│      │         │      │          │      │                │
│      └─────────┴──────┘          │      │                │
│             │                    │      │                │
│             ▼                    │      ▼                │
│        MySQL (Prisma) ◄──────────┼─ ACCESO DIRECTO       │
│             │                    │      │                │
│             ▼                    │      ▼                │
│    Google Drive API              │ Google Drive API       │
│    S3 Compatible                 │ S3 Compatible         │
└──────────────────────────────────┴───────────────────────┘
                                          │
                                          ▼
                                    LLM (Claude, Kiro...)
```

El MCP Server **NO pasa por la API REST**. Accede directamente a la misma DB y APIs.

---

## Instalacion con Docker

```bash
git clone https://github.com/ydiaz1699/9Drive_mcp.git
cd 9Drive_mcp
cp .env.docker.example .env
# Editar .env con tus valores
docker compose up -d --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- MCP (SSE): http://localhost:3500

---

## Instalacion Manual

```bash
git clone https://github.com/ydiaz1699/9Drive_mcp.git
cd 9Drive_mcp

# Backend
cd backend && npm install && npx prisma generate && npx prisma migrate dev && npm run dev

# Frontend (otra terminal)
cd frontend && npm install && npm run dev

# MCP Server (otra terminal)
cd mcp-server && npm install && npm run prisma:generate && npm run dev
```

El MCP necesita la **misma DATABASE_URL y TOKEN_ENCRYPTION_KEY** que el backend.

---

## Conectar con Claude Desktop

```json
{
  "mcpServers": {
    "9drive": {
      "command": "node",
      "args": ["/ruta/a/9Drive_mcp/mcp-server/dist/index.js"],
      "env": {
        "DATABASE_URL": "mysql://root:password@localhost:3306/9drive",
        "TOKEN_ENCRYPTION_KEY": "misma-clave-del-backend"
      }
    }
  }
}
```

---

## Tools MCP (17 tools)

| Tool | Descripcion |
|------|-------------|
| `listAccounts` | Cuentas conectadas con cuota |
| `syncAccountQuota` | Sincronizar cuota Google/S3 |
| `storageSummary` | Resumen total de almacenamiento |
| `listFolders` | Carpetas con conteo |
| `createFolder` | Crear carpeta |
| `deleteFolder` | Eliminar carpeta |
| `renameFolder` | Renombrar carpeta |
| `listFiles` | Archivos con filtros |
| `getFile` | Detalle de archivo |
| `uploadFile` | Subir archivo (base64) con routing |
| `deleteFile` | Eliminar archivo |
| `renameFile` | Renombrar (DB + Drive) |
| `moveFile` | Mover a carpeta |
| `shareFile` | Enlace compartido |
| `unshareFile` | Revocar enlaces |
| `getDownloadUrl` | URL de descarga |
| `syncDrive` | Sync completo Drive -> DB |

---

## Estructura

```
9Drive_mcp/
├── backend/          # API REST (Express + Prisma)
├── frontend/         # UI (React + Vite)
├── mcp-server/       # MCP Server (acceso directo a DB)
│   ├── src/index.ts
│   ├── src/lib/      # crypto, google, s3, prisma
│   └── src/tools/    # accounts, files, folders
├── docker-compose.yml
└── README.md
```

## Seguridad

- Tokens cifrados AES-256-GCM (misma clave que backend)
- Archivos NO se guardan en servidor
- 100% independiente del repo original

## Licencia

MIT
