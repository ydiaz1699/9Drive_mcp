import { z } from 'zod'
import { google } from 'googleapis'
import { prisma } from '../lib/prisma.js'
import { env } from '../lib/env.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { getAuthedGoogleClient, ensureGoogleAppFolder, syncGoogleQuota } from '../lib/google.js'
import { deleteS3Object, syncS3Quota, buildS3ObjectKey, uploadS3Object, getS3ConfigForAccount } from '../lib/s3.js'
import type { ConnectedAccount } from '@prisma/client'
import { Readable } from 'node:stream'

const googleDriveFolderMimeType = 'application/vnd.google-apps.folder'

// --- listFiles ---

export const listFilesSchema = {
  userId: z.string().describe('The user ID'),
  folderId: z.string().optional().describe('Filter by folder ID'),
  query: z.string().optional().describe('Search by file name'),
  accountId: z.string().optional().describe('Filter by connected account ID'),
}

export async function listFiles({ userId, folderId, query, accountId }: { userId: string; folderId?: string; query?: string; accountId?: string }) {
  const files = await prisma.file.findMany({
    where: {
      userId,
      status: 'active',
      ...(folderId ? { folderId } : {}),
      ...(query ? { name: { contains: query } } : {}),
      ...(accountId ? { connectedAccountId: accountId } : {}),
    },
    include: {
      connectedAccount: { select: { id: true, email: true, provider: true } },
      folder: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return {
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      provider: file.provider,
      folderId: file.folderId,
      folder: file.folder,
      connectedAccount: file.connectedAccount,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    })),
  }
}

// --- getFile ---

export const getFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to retrieve'),
}

export async function getFile({ userId, fileId }: { userId: string; fileId: string }) {
  const file = await prisma.file.findFirstOrThrow({
    where: { id: fileId, userId },
    include: {
      connectedAccount: { select: { id: true, email: true, provider: true } },
      folder: { select: { id: true, name: true } },
    },
  })

  return {
    file: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      provider: file.provider,
      providerFileId: file.providerFileId,
      status: file.status,
      folderId: file.folderId,
      folder: file.folder,
      connectedAccount: file.connectedAccount,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      deletedAt: file.deletedAt?.toISOString() ?? null,
    },
  }
}

// --- uploadFile ---

async function selectAccountByPolicy(userId: string, sizeBytes: bigint): Promise<ConnectedAccount> {
  const policy = await prisma.uploadRoutingPolicy.findUnique({ where: { userId } })
  const mode = policy?.mode ?? 'most_available'

  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: 'connected' },
    include: { storageAccount: true },
  })

  if (accounts.length === 0) throw new Error('No connected accounts available for upload.')

  if (mode === 'priority' && policy?.priorityAccountIds) {
    const priorityIds = policy.priorityAccountIds as string[]
    for (const id of priorityIds) {
      const account = accounts.find((a) => a.id === id)
      if (account) {
        const available = account.storageAccount?.availableBytes
        if (available === null || available === undefined || available >= sizeBytes) return account
      }
    }
  }

  if (mode === 'round_robin' && policy) {
    const cursor = policy.roundRobinCursor % accounts.length
    const selected = accounts[cursor]
    await prisma.uploadRoutingPolicy.update({
      where: { id: policy.id },
      data: { roundRobinCursor: (cursor + 1) % accounts.length },
    })
    return selected
  }

  // Default: most_available
  const sorted = accounts
    .filter((a) => a.storageAccount)
    .sort((a, b) => {
      const availA = a.storageAccount?.availableBytes ?? 0n
      const availB = b.storageAccount?.availableBytes ?? 0n
      if (availB > availA) return 1
      if (availB < availA) return -1
      return 0
    })

  return sorted[0] ?? accounts[0]
}

export const uploadFileSchema = {
  userId: z.string().describe('The user ID uploading the file'),
  fileName: z.string().min(1).max(255).describe('Name of the file'),
  mimeType: z.string().describe('MIME type of the file'),
  sizeBytes: z.number().describe('File size in bytes'),
  base64Content: z.string().describe('Base64-encoded file content'),
  folderId: z.string().optional().describe('Target folder ID'),
  accountId: z.string().optional().describe('Specific account to upload to (overrides routing policy)'),
}

export async function uploadFile({ userId, fileName, mimeType, sizeBytes, base64Content, folderId, accountId }: { userId: string; fileName: string; mimeType: string; sizeBytes: number; base64Content: string; folderId?: string; accountId?: string }) {
  if (sizeBytes > env.MAX_UPLOAD_BYTES) {
    return { status: 'error', message: `File exceeds max upload size of ${env.MAX_UPLOAD_BYTES} bytes.` }
  }

  if (folderId) {
    await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } })
  }

  let account: ConnectedAccount
  if (accountId) {
    account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, status: 'connected' } })
  } else {
    account = await selectAccountByPolicy(userId, BigInt(sizeBytes))
  }

  const buffer = Buffer.from(base64Content, 'base64')
  const stream = Readable.from(buffer)

  let providerFileId: string

  if (account.provider === 's3') {
    const config = await getS3ConfigForAccount(account.id, userId)
    const fileId = crypto.randomUUID()
    const key = buildS3ObjectKey(config, userId, fileId, fileName)
    await uploadS3Object(config, key, stream as unknown as NodeJS.ReadableStream, mimeType)
    providerFileId = key
  } else {
    // Google Drive
    const auth = await getAuthedGoogleClient(account)
    const drive = google.drive({ version: 'v3', auth })
    const appFolderId = await ensureGoogleAppFolder(account)

    let parentId = appFolderId
    if (folderId) {
      const folder = await prisma.folder.findFirst({ where: { id: folderId, userId, connectedAccountId: account.id } })
      if (folder?.providerFolderId) parentId = folder.providerFolderId
    }

    const response = await drive.files.create({
      requestBody: { name: fileName, mimeType, parents: [parentId] },
      media: { mimeType, body: stream },
      fields: 'id',
    })

    providerFileId = response.data.id!
  }

  const file = await prisma.file.create({
    data: {
      userId,
      connectedAccountId: account.id,
      provider: account.provider,
      providerFileId,
      name: fileName,
      mimeType,
      sizeBytes: BigInt(sizeBytes),
      status: 'active',
      folderId: folderId ?? null,
    },
  })

  return {
    status: 'ok',
    file: {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      provider: file.provider,
      accountId: account.id,
      folderId: file.folderId,
      createdAt: file.createdAt.toISOString(),
    },
  }
}

// --- deleteFile ---

export const deleteFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to soft-delete'),
}

export async function deleteFile({ userId, fileId }: { userId: string; fileId: string }) {
  const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId, status: 'active' } })
  await prisma.file.update({ where: { id: file.id }, data: { status: 'deleted', deletedAt: new Date() } })
  return { status: 'ok', deletedId: file.id }
}

// --- renameFile ---

export const renameFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to rename'),
  name: z.string().min(1).max(255).describe('New file name'),
}

export async function renameFile({ userId, fileId, name }: { userId: string; fileId: string; name: string }) {
  const file = await prisma.file.findFirstOrThrow({
    where: { id: fileId, userId },
    include: { connectedAccount: true },
  })

  if (file.provider === 'google_drive') {
    const auth = await getAuthedGoogleClient(file.connectedAccount)
    const drive = google.drive({ version: 'v3', auth })
    await drive.files.update({ fileId: file.providerFileId, requestBody: { name } })
  }

  const updated = await prisma.file.update({ where: { id: file.id }, data: { name } })
  return {
    status: 'ok',
    file: { id: updated.id, name: updated.name, updatedAt: updated.updatedAt.toISOString() },
  }
}

// --- moveFile ---

export const moveFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to move'),
  folderId: z.string().nullable().describe('Target folder ID (null for root)'),
}

export async function moveFile({ userId, fileId, folderId }: { userId: string; fileId: string; folderId: string | null }) {
  if (folderId) {
    await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } })
  }
  const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId, status: 'active' } })
  const updated = await prisma.file.update({ where: { id: file.id }, data: { folderId } })
  return {
    status: 'ok',
    file: { id: updated.id, name: updated.name, folderId: updated.folderId, updatedAt: updated.updatedAt.toISOString() },
  }
}

// --- shareFile ---

export const shareFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to share'),
}

export async function shareFile({ userId, fileId }: { userId: string; fileId: string }) {
  const file = await prisma.file.findFirstOrThrow({ where: { id: fileId, userId, status: 'active' } })

  const existingShare = await prisma.fileShare.findFirst({
    where: { fileId: file.id, userId, enabled: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  })

  if (existingShare) {
    return { status: 'ok', shareId: existingShare.id, token: existingShare.token, isExisting: true }
  }

  const token = randomToken(32)
  const share = await prisma.fileShare.create({
    data: { fileId: file.id, userId, token, tokenHash: hashToken(token) },
  })

  return { status: 'ok', shareId: share.id, token, isExisting: false }
}

// --- unshareFile ---

export const unshareFileSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to unshare'),
}

export async function unshareFile({ userId, fileId }: { userId: string; fileId: string }) {
  await prisma.fileShare.updateMany({
    where: { fileId, userId, enabled: true },
    data: { enabled: false },
  })
  return { status: 'ok' }
}

// --- getDownloadUrl ---

export const getDownloadUrlSchema = {
  userId: z.string().describe('The user ID'),
  fileId: z.string().describe('The file ID to get download URL for'),
}

export async function getDownloadUrl({ userId, fileId }: { userId: string; fileId: string }) {
  const file = await prisma.file.findFirstOrThrow({
    where: { id: fileId, userId },
    include: { connectedAccount: true },
  })

  if (file.provider === 's3') {
    return { status: 'ok', url: null, message: 'S3 files require direct streaming; no public URL available.' }
  }

  const auth = await getAuthedGoogleClient(file.connectedAccount)
  const drive = google.drive({ version: 'v3', auth })
  const metadata = await drive.files.get({ fileId: file.providerFileId, fields: 'webViewLink,webContentLink' })
  return { status: 'ok', url: metadata.data.webContentLink ?? metadata.data.webViewLink ?? null }
}

// --- syncDrive ---

export const syncDriveSchema = {
  userId: z.string().describe('The user ID'),
  accountId: z.string().optional().describe('Specific Google Drive account ID to sync (omit to sync all)'),
}

export async function syncDrive({ userId, accountId }: { userId: string; accountId?: string }) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, provider: 'google_drive', status: 'connected', ...(accountId ? { id: accountId } : {}) },
  })

  if (accounts.length === 0) return { status: 'ok', results: [], message: 'No Google Drive accounts found.' }

  const results = []
  for (const account of accounts) {
    const result = await syncGoogleAppFolderFiles(account.id, userId)
    results.push(result)
  }

  return { status: 'ok', results }
}

// --- syncGoogleAppFolderFiles (local implementation mirroring backend) ---

type DriveFileMetadata = {
  id: string
  name: string
  mimeType: string
  sizeBytes: bigint
  parentId: string
}

async function syncGoogleAppFolderFiles(accountId: string, userId: string) {
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { id: accountId, userId, provider: 'google_drive', status: 'connected' } })
  const auth = await getAuthedGoogleClient(account)
  const drive = google.drive({ version: 'v3', auth })
  const appFolderId = await ensureGoogleAppFolder(account)

  const userFolders = await prisma.folder.findMany({
    where: { userId, connectedAccountId: account.id, deletedAt: null },
    select: { id: true, providerFolderId: true },
  })
  const parentIds = [
    appFolderId,
    ...userFolders.map((f) => f.providerFolderId).filter((id): id is string => !!id),
  ]

  const driveFiles: DriveFileMetadata[] = []
  let pageToken: string | undefined

  const parentsQuery = parentIds.map((id) => `'${id}' in parents`).join(' or ')
  const q = `(${parentsQuery}) and mimeType != '${googleDriveFolderMimeType}' and trashed = false`

  do {
    const response = await drive.files.list({
      q,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,size,parents)',
      pageSize: 1000,
      pageToken,
    })
    for (const file of response.data.files ?? []) {
      if (!file.id || !file.name || !file.mimeType) continue
      const parentId = file.parents?.[0] ?? appFolderId
      driveFiles.push({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: BigInt(file.size ?? 0), parentId })
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  const existingFiles = await prisma.file.findMany({ where: { userId, connectedAccountId: account.id, provider: 'google_drive' } })
  const existingByProviderId = new Map(existingFiles.map((file) => [file.providerFileId, file]))
  const driveFileIds = new Set(driveFiles.map((file) => file.id))
  let created = 0
  let updated = 0
  let deleted = 0

  const folderIdMap = new Map(userFolders.map((f) => [f.providerFolderId, f.id]))

  for (const driveFile of driveFiles) {
    const dbFolderId = driveFile.parentId === appFolderId ? null : (folderIdMap.get(driveFile.parentId) ?? null)
    const existing = existingByProviderId.get(driveFile.id)
    if (!existing) {
      await prisma.file.create({
        data: { userId, connectedAccountId: account.id, provider: 'google_drive', providerFileId: driveFile.id, name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, status: 'active', folderId: dbFolderId },
      })
      created += 1
      continue
    }

    const needsUpdate = existing.name !== driveFile.name || existing.mimeType !== driveFile.mimeType || existing.sizeBytes !== driveFile.sizeBytes || existing.status !== 'active' || existing.deletedAt !== null || existing.folderId !== dbFolderId
    if (needsUpdate) {
      await prisma.file.update({
        where: { id: existing.id },
        data: { name: driveFile.name, mimeType: driveFile.mimeType, sizeBytes: driveFile.sizeBytes, status: 'active', deletedAt: null, folderId: dbFolderId },
      })
      updated += 1
    }
  }

  const missingActiveIds = existingFiles.filter((file) => file.status === 'active' && !driveFileIds.has(file.providerFileId)).map((file) => file.id)
  if (missingActiveIds.length > 0) {
    const result = await prisma.file.updateMany({ where: { id: { in: missingActiveIds }, userId }, data: { status: 'deleted', deletedAt: new Date() } })
    deleted = result.count
  }

  await syncGoogleQuota(account.id).catch(() => undefined)
  return { accountId: account.id, created, updated, deleted }
}
