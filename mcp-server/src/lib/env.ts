import dotenv from 'dotenv'
import { resolve } from 'node:path'

dotenv.config({ path: resolve(process.cwd(), '.env'), override: false })
dotenv.config({ path: resolve(process.cwd(), '../backend/.env'), override: false })

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY ?? '',
  MCP_TRANSPORT: process.env.MCP_TRANSPORT ?? 'stdio',
  MCP_PORT: Number(process.env.MCP_PORT ?? 3500),
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024 * 1024),
}
