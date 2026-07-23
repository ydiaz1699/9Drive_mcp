#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { config } from "./lib/config.js";
import { createServer } from "http";
import { URL } from "url";

// ─── Tool imports ────────────────────────────────────
import {
  listAccountsSchema, listAccounts,
  getOAuthUrlSchema, getOAuthUrl,
  connectGoogleDriveSchema, connectGoogleDrive,
  connectS3Schema, connectS3,
  disconnectAccountSchema, disconnectAccount,
  syncQuotaSchema, syncQuota,
} from "./tools/accounts.js";

import {
  listFoldersSchema, listFolders,
  createFolderSchema, createFolder,
  deleteFolderSchema, deleteFolder,
  renameFolderSchema, renameFolder,
} from "./tools/folders.js";

import {
  listFilesSchema, listFiles,
  getFileSchema, getFile,
  deleteFileSchema, deleteFile,
  deleteFilesSchema, deleteFiles,
  renameFileSchema, renameFile,
  moveFileSchema, moveFile,
  shareFileSchema, shareFile,
  unshareFileSchema, unshareFile,
  getDownloadUrlSchema, getDownloadUrl,
  syncDriveSchema, syncDrive,
  uploadFileSchema, uploadFile,
} from "./tools/files.js";

import { storageSummarySchema, storageSummary } from "./tools/storage.js";


// ─── Crear servidor MCP ──────────────────────────────
const server = new McpServer({
  name: "9drive-mcp",
  version: "1.0.0",
  description: "Servidor MCP para almacenamiento unificado Google Drive + S3",
});

// ═══ TOOLS: Cuentas ══════════════════════════════════

server.tool(
  "list_accounts",
  "Lista todas las cuentas de almacenamiento conectadas (Google Drive y S3)",
  listAccountsSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await listAccounts(params), null, 2) }],
  })
);

server.tool(
  "get_oauth_url",
  "Genera URL de autorización OAuth2 para conectar Google Drive",
  getOAuthUrlSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await getOAuthUrl(params), null, 2) }],
  })
);

server.tool(
  "connect_google_drive",
  "Conecta una cuenta de Google Drive usando código de autorización",
  connectGoogleDriveSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await connectGoogleDrive(params), null, 2) }],
  })
);

server.tool(
  "connect_s3",
  "Conecta almacenamiento S3 compatible (AWS, MinIO, R2, Wasabi, B2)",
  connectS3Schema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await connectS3(params), null, 2) }],
  })
);

server.tool(
  "disconnect_account",
  "Desconecta y elimina una cuenta de almacenamiento",
  disconnectAccountSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await disconnectAccount(params), null, 2) }],
  })
);

server.tool(
  "sync_quota",
  "Sincroniza la cuota/espacio de una cuenta conectada",
  syncQuotaSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await syncQuota(params), null, 2) }],
  })
);


// ═══ TOOLS: Carpetas ═════════════════════════════════

server.tool(
  "list_folders",
  "Lista carpetas virtuales del usuario",
  listFoldersSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await listFolders(params), null, 2) }],
  })
);

server.tool(
  "create_folder",
  "Crea una carpeta virtual para organizar archivos",
  createFolderSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await createFolder(params), null, 2) }],
  })
);

server.tool(
  "delete_folder",
  "Elimina una carpeta virtual (archivos se mueven a raíz)",
  deleteFolderSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await deleteFolder(params), null, 2) }],
  })
);

server.tool(
  "rename_folder",
  "Renombra una carpeta virtual",
  renameFolderSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await renameFolder(params), null, 2) }],
  })
);

// ═══ TOOLS: Archivos ═════════════════════════════════

server.tool(
  "list_files",
  "Lista archivos con filtros por carpeta, búsqueda y paginación",
  listFilesSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await listFiles(params), null, 2) }],
  })
);

server.tool(
  "get_file",
  "Obtiene detalles de un archivo específico",
  getFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await getFile(params), null, 2) }],
  })
);

server.tool(
  "upload_file",
  "Sube un archivo a Google Drive o S3 (contenido en base64)",
  uploadFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await uploadFile(params), null, 2) }],
  })
);

server.tool(
  "delete_file",
  "Elimina un archivo del almacenamiento y la base de datos",
  deleteFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await deleteFile(params), null, 2) }],
  })
);

server.tool(
  "delete_files_batch",
  "Elimina múltiples archivos a la vez",
  deleteFilesSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await deleteFiles(params), null, 2) }],
  })
);

server.tool(
  "rename_file",
  "Renombra un archivo (también en Google Drive si aplica)",
  renameFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await renameFile(params), null, 2) }],
  })
);

server.tool(
  "move_file",
  "Mueve un archivo a otra carpeta virtual",
  moveFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await moveFile(params), null, 2) }],
  })
);

server.tool(
  "share_file",
  "Genera un enlace temporal para compartir un archivo",
  shareFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await shareFile(params), null, 2) }],
  })
);

server.tool(
  "unshare_file",
  "Revoca el enlace compartido de un archivo",
  unshareFileSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await unshareFile(params), null, 2) }],
  })
);

server.tool(
  "get_download_url",
  "Obtiene la URL de descarga directa de un archivo",
  getDownloadUrlSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await getDownloadUrl(params), null, 2) }],
  })
);

server.tool(
  "sync_drive",
  "Sincroniza archivos de la carpeta 9drive en Google Drive con la DB local",
  syncDriveSchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await syncDrive(params), null, 2) }],
  })
);

// ═══ TOOLS: Almacenamiento ═══════════════════════════

server.tool(
  "storage_summary",
  "Resumen de cuota y espacio de todas las cuentas del usuario",
  storageSummarySchema.shape,
  async (params) => ({
    content: [{ type: "text", text: JSON.stringify(await storageSummary(params), null, 2) }],
  })
);


// ═══ Iniciar servidor ════════════════════════════════

async function main() {
  const transportArg = process.argv.includes("--transport")
    ? process.argv[process.argv.indexOf("--transport") + 1]
    : config.mcp.transport;

  if (transportArg === "sse") {
    let sseTransport: SSEServerTransport | null = null;

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${config.mcp.port}`);

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/sse") {
        sseTransport = new SSEServerTransport("/messages", res);
        await server.connect(sseTransport);
        return;
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        if (sseTransport) {
          await sseTransport.handlePostMessage(req, res);
        } else {
          res.writeHead(400);
          res.end("No SSE connection");
        }
        return;
      }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", server: "9drive-mcp" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(config.mcp.port, () => {
      console.error(`🚀 9Drive MCP Server (SSE) en http://localhost:${config.mcp.port}`);
      console.error(`   SSE endpoint: http://localhost:${config.mcp.port}/sse`);
      console.error(`   Health check: http://localhost:${config.mcp.port}/health`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 9Drive MCP Server (stdio) iniciado");
  }
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
