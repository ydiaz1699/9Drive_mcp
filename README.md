# 9Drive MCP Server

Servidor MCP (Model Context Protocol) self-hosted para almacenamiento unificado Google Drive + S3. Permite que un LLM (Claude, GPT, etc.) gestione tus archivos en la nube directamente.

## Que es esto?

Un servidor MCP que accede **directamente** a Google Drive y almacenamiento S3-compatible sin intermediarios. Puedes conectarlo a:

- **Claude Desktop** (via stdio)
- **Kiro** (via stdio)
- **Cualquier cliente MCP** (via SSE/HTTP)
- **Tu propia UI** (via SSE endpoint)

### Funcionalidades

- Conectar multiples cuentas de Google Drive
- Conectar almacenamiento S3 (AWS, MinIO, Cloudflare R2, Wasabi, Backblaze B2)
- Subir archivos con routing inteligente (mas espacio disponible, round-robin, prioridad)
- Descargar, renombrar, mover, eliminar archivos
- Carpetas virtuales para organizar
- Compartir archivos con enlaces temporales
- Sincronizar desde Google Drive a la DB local
- Resumen de cuota/espacio de todas las cuentas

---

## Requisitos

- **Node.js 20+**
- **npm**
- **MySQL 8.0+** (o Docker)
- **Google Cloud Project** (para Google Drive)

---

## Instalacion Rapida con Docker (Recomendado)

### 1. Clonar el repositorio

```bash
git clone https://github.com/ydiaz1699/9Drive_mcp.git
cd 9Drive_mcp
```

### 2. Configurar variables de entorno

```bash
cp .env.docker.example .env
```

Editar `.env` con tus valores:

```env
MYSQL_ROOT_PASSWORD=tu-password-seguro
MYSQL_DATABASE=9drive_mcp
MCP_TRANSPORT=sse
MCP_PORT=3500
GOOGLE_CLIENT_ID=tu-client-id
GOOGLE_CLIENT_SECRET=tu-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3500/oauth/google/callback
TOKEN_ENCRYPTION_KEY=cambia-esta-clave-de-32-chars!!
UPLOAD_POLICY=most-available
```

### 3. Levantar los contenedores

```bash
docker compose up -d --build
```

### 4. Verificar que funciona

```bash
curl http://localhost:3500/health
# Respuesta: {"status":"ok","server":"9drive-mcp"}
```

### 5. Crear usuario inicial (opcional)

```bash
docker compose exec mcp-server npm run seed
```

---

## Instalacion Manual (Sin Docker)

### 1. Clonar e instalar dependencias

```bash
git clone https://github.com/ydiaz1699/9Drive_mcp.git
cd 9Drive_mcp
npm install
```

### 2. Crear base de datos MySQL

```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS 9drive_mcp;"
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env`:

```env
DATABASE_URL="mysql://root:tu-password@localhost:3306/9drive_mcp"
MCP_TRANSPORT="stdio"
GOOGLE_CLIENT_ID="tu-client-id"
GOOGLE_CLIENT_SECRET="tu-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3500/oauth/google/callback"
TOKEN_ENCRYPTION_KEY="cambia-esta-clave-de-32-chars!!"
UPLOAD_POLICY="most-available"
```

### 4. Generar cliente Prisma y migrar

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Crear usuario inicial

```bash
npm run seed
```

### 6. Compilar y ejecutar

```bash
# Compilar TypeScript
npm run build

# Ejecutar en modo stdio (para Claude Desktop/Kiro)
npm start

# O ejecutar en modo SSE (para UI/clientes remotos)
npm run dev:sse
```

---

## Configurar Google Cloud (Paso a Paso)

### 1. Crear proyecto en Google Cloud Console

- Ir a: https://console.cloud.google.com/
- Crear un proyecto nuevo o seleccionar uno existente

### 2. Habilitar Google Drive API

- Ir a: **APIs & Services > Library**
- Buscar: **Google Drive API**
- Click en **Enable**

### 3. Configurar pantalla de consentimiento OAuth

- Ir a: **APIs & Services > OAuth consent screen**
- Tipo: **External**
- Agregar scopes:
  - `https://www.googleapis.com/auth/drive`
  - `https://www.googleapis.com/auth/userinfo.email`
  - `https://www.googleapis.com/auth/userinfo.profile`
- Agregar tu email como usuario de prueba

### 4. Crear credenciales OAuth

- Ir a: **APIs & Services > Credentials**
- Click: **Create Credentials > OAuth client ID**
- Tipo: **Web application**
- Origen autorizado: `http://localhost:3500`
- URI de redireccion: `http://localhost:3500/oauth/google/callback`
- Copiar **Client ID** y **Client Secret**

### 5. Poner credenciales en .env

```env
GOOGLE_CLIENT_ID="123456-abc.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-tu-secret"
GOOGLE_REDIRECT_URI="http://localhost:3500/oauth/google/callback"
```

---

## Conectar con Claude Desktop

Agregar al archivo de configuracion de Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "9drive": {
      "command": "node",
      "args": ["/ruta/completa/a/9Drive_mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "mysql://root:password@localhost:3306/9drive_mcp",
        "GOOGLE_CLIENT_ID": "tu-client-id",
        "GOOGLE_CLIENT_SECRET": "tu-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3500/oauth/google/callback",
        "TOKEN_ENCRYPTION_KEY": "cambia-esta-clave-de-32-chars!!"
      }
    }
  }
}
```

Ubicacion del archivo de config:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

---

## Conectar con Kiro

Agregar al archivo `.kiro/settings/mcp.json` en tu workspace:

```json
{
  "mcpServers": {
    "9drive": {
      "command": "node",
      "args": ["/ruta/completa/a/9Drive_mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "mysql://root:password@localhost:3306/9drive_mcp",
        "GOOGLE_CLIENT_ID": "tu-client-id",
        "GOOGLE_CLIENT_SECRET": "tu-client-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:3500/oauth/google/callback",
        "TOKEN_ENCRYPTION_KEY": "cambia-esta-clave-de-32-chars!!"
      }
    }
  }
}
```

---

## Conectar via SSE (Para UIs o clientes remotos)

Ejecutar el servidor en modo SSE:

```bash
npm run dev:sse
# o en produccion:
node dist/index.js --transport sse
```

Endpoints disponibles:

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/sse` | GET | Conexion SSE para cliente MCP |
| `/messages` | POST | Enviar mensajes al servidor |
| `/health` | GET | Health check |

---

## Tools Disponibles (18 total)

### Cuentas de Almacenamiento

| Tool | Descripcion |
|------|-------------|
| `list_accounts` | Lista cuentas conectadas (Drive + S3) |
| `get_oauth_url` | Genera URL para autorizar Google Drive |
| `connect_google_drive` | Conecta cuenta con codigo OAuth |
| `connect_s3` | Conecta almacenamiento S3 compatible |
| `disconnect_account` | Desconecta una cuenta |
| `sync_quota` | Actualiza info de cuota/espacio |

### Archivos

| Tool | Descripcion |
|------|-------------|
| `list_files` | Lista archivos con filtros y paginacion |
| `get_file` | Detalles de un archivo |
| `upload_file` | Sube archivo (base64) con routing inteligente |
| `delete_file` | Elimina un archivo |
| `delete_files_batch` | Elimina multiples archivos |
| `rename_file` | Renombra archivo (tambien en Drive) |
| `move_file` | Mueve a otra carpeta virtual |
| `share_file` | Genera enlace temporal para compartir |
| `unshare_file` | Revoca enlace compartido |
| `get_download_url` | Obtiene URL de descarga directa |
| `sync_drive` | Sincroniza carpeta 9drive de Drive a DB |

### Carpetas

| Tool | Descripcion |
|------|-------------|
| `list_folders` | Lista carpetas virtuales |
| `create_folder` | Crea carpeta |
| `delete_folder` | Elimina carpeta |
| `rename_folder` | Renombra carpeta |

### Almacenamiento

| Tool | Descripcion |
|------|-------------|
| `storage_summary` | Resumen de cuota total de todas las cuentas |

---

## Politicas de Subida (Upload Routing)

Configurar en `.env` con `UPLOAD_POLICY`:

| Politica | Comportamiento |
|----------|---------------|
| `most-available` | Sube a la cuenta con mas espacio libre (por defecto) |
| `round-robin` | Distribuye equitativamente entre cuentas |
| `priority-order` | Usa la cuenta con mayor prioridad que tenga espacio |

---

## Ejemplo de Uso con un LLM

Una vez conectado, puedes pedirle al LLM cosas como:

```
"Lista mis archivos en Google Drive"
"Sube este documento a la cuenta con mas espacio"
"Crea una carpeta llamada Proyectos y mueve los PDFs ahi"
"Dame un resumen de cuanto espacio me queda en total"
"Sincroniza mi Drive para ver archivos nuevos"
"Comparte el archivo informe.pdf con un enlace temporal de 48 horas"
"Conecta mi bucket de MinIO: endpoint http://minio:9000, bucket=datos"
```

---

## Estructura del Proyecto

```
9Drive_mcp/
├── prisma/
│   └── schema.prisma          # Modelos de base de datos
├── src/
│   ├── index.ts               # Servidor MCP principal
│   ├── seed.ts                # Script de datos iniciales
│   ├── lib/
│   │   ├── config.ts          # Configuracion centralizada
│   │   ├── encryption.ts      # Cifrado AES-256-GCM
│   │   └── prisma.ts          # Cliente Prisma
│   ├── services/
│   │   ├── google-drive.ts    # API Google Drive v3
│   │   └── s3.ts              # AWS SDK S3
│   └── tools/
│       ├── accounts.ts        # Tools de cuentas
│       ├── files.ts           # Tools de archivos
│       ├── folders.ts         # Tools de carpetas
│       └── storage.ts         # Tools de almacenamiento
├── docker-compose.yml
├── Dockerfile
├── docker-entrypoint.sh
├── package.json
├── tsconfig.json
├── .env.example
├── .env.docker.example
└── README.md
```

---

## Seguridad

- Tokens de Google se almacenan **cifrados** (AES-256-GCM) en MySQL
- Credenciales S3 se almacenan **cifradas**
- Los archivos NO se guardan en el servidor, se transmiten directamente
- `TOKEN_ENCRYPTION_KEY` debe ser fuerte y secreta
- El `.env` esta en `.gitignore` y nunca se sube al repo
- Enlaces compartidos usan tokens hasheados (SHA-256)

---

## Produccion

Para desplegar en produccion:

1. Usar HTTPS (reverse proxy con nginx/caddy)
2. Cambiar `TOKEN_ENCRYPTION_KEY` por algo aleatorio de 32+ chars
3. Usar password fuerte para MySQL
4. No exponer puerto MySQL publicamente
5. Actualizar URIs de Google OAuth con tu dominio
6. Considerar limitar CORS en el servidor SSE

---

## Licencia

MIT
