import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import { createServer } from 'node:http'
import { env } from './lib/env.js'

import {
  listAccounts, listAccountsSchema,
  syncAccountQuota, syncAccountQuotaSchema,
  storageSummary, storageSummarySchema,
} from './tools/accounts.js'

import {
  listFolders, listFoldersSchema,
  createFolder, createFolderSchema,
  deleteFolder, deleteFolderSchema,
  renameFolder, renameFolderSchema,
} from './tools/folders.js'

import {
  listFiles, listFilesSchema,
  getFile, getFileSchema,
  uploadFile, uploadFileSchema,
  deleteFile, deleteFileSchema,
  renameFile, renameFileSchema,
  moveFile, moveFileSchema,
  shareFile, shareFileSchema,
  unshareFile, unshareFileSchema,
  getDownloadUrl, getDownloadUrlSchema,
  syncDrive, syncDriveSchema,
} from './tools/files.js'

const server = new McpServer({
  name: '9drive-mcp',
  version: '1.0.0',
})

// Account tools
server.tool('listAccounts', 'List all connected storage accounts for a user', listAccountsSchema, async (params) => {
  const result = await listAccounts(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('syncAccountQuota', 'Sync storage quota for a connected account', syncAccountQuotaSchema, async (params) => {
  const result = await syncAccountQuota(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('storageSummary', 'Get aggregated storage summary across all accounts', storageSummarySchema, async (params) => {
  const result = await storageSummary(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

// Folder tools
server.tool('listFolders', 'List folders for a user (optionally within a parent folder)', listFoldersSchema, async (params) => {
  const result = await listFolders(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('createFolder', 'Create a new folder', createFolderSchema, async (params) => {
  const result = await createFolder(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('deleteFolder', 'Soft-delete a folder', deleteFolderSchema, async (params) => {
  const result = await deleteFolder(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('renameFolder', 'Rename a folder', renameFolderSchema, async (params) => {
  const result = await renameFolder(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

// File tools
server.tool('listFiles', 'List files for a user with optional filters', listFilesSchema, async (params) => {
  const result = await listFiles(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('getFile', 'Get detailed information about a specific file', getFileSchema, async (params) => {
  const result = await getFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('uploadFile', 'Upload a file to a connected storage account (uses routing policy if no account specified)', uploadFileSchema, async (params) => {
  const result = await uploadFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('deleteFile', 'Soft-delete a file (moves to trash)', deleteFileSchema, async (params) => {
  const result = await deleteFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('renameFile', 'Rename a file (also renames in Google Drive if applicable)', renameFileSchema, async (params) => {
  const result = await renameFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('moveFile', 'Move a file to a different folder', moveFileSchema, async (params) => {
  const result = await moveFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('shareFile', 'Create a share link for a file', shareFileSchema, async (params) => {
  const result = await shareFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('unshareFile', 'Disable all share links for a file', unshareFileSchema, async (params) => {
  const result = await unshareFile(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('getDownloadUrl', 'Get a download URL for a file', getDownloadUrlSchema, async (params) => {
  const result = await getDownloadUrl(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

server.tool('syncDrive', 'Sync files from Google Drive app folder to local database', syncDriveSchema, async (params) => {
  const result = await syncDrive(params)
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
})

// Main entry point
async function main() {
  const args = process.argv.slice(2)
  const transportArg = args.find((a) => a.startsWith('--transport'))?.split('=')?.[1]
    ?? args[args.indexOf('--transport') + 1]
  const transport = transportArg ?? env.MCP_TRANSPORT

  if (transport === 'sse') {
    const transports = new Map<string, SSEServerTransport>()

    const httpServer = createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', `http://localhost:${env.MCP_PORT}`)

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', transport: 'sse' }))
        return
      }

      if (url.pathname === '/sse') {
        const sseTransport = new SSEServerTransport('/messages', res)
        transports.set(sseTransport.sessionId, sseTransport)
        res.on('close', () => { transports.delete(sseTransport.sessionId) })
        await server.connect(sseTransport)
        return
      }

      if (url.pathname === '/messages') {
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }))
          return
        }
        const sseTransport = transports.get(sessionId)!
        await sseTransport.handlePostMessage(req, res)
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    httpServer.listen(env.MCP_PORT, () => {
      console.error(`9drive-mcp SSE server running on http://localhost:${env.MCP_PORT}`)
      console.error(`  SSE endpoint: http://localhost:${env.MCP_PORT}/sse`)
      console.error(`  Messages endpoint: http://localhost:${env.MCP_PORT}/messages`)
      console.error(`  Health check: http://localhost:${env.MCP_PORT}/health`)
    })
  } else {
    const stdioTransport = new StdioServerTransport()
    await server.connect(stdioTransport)
    console.error('9drive-mcp running on stdio')
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
