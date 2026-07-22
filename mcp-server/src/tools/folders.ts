import { z } from 'zod'
import { prisma } from '../lib/prisma.js'

export const listFoldersSchema = {
  userId: z.string().describe('The user ID to list folders for'),
  parentId: z.string().optional().describe('Parent folder ID to list children of (omit for root folders)'),
}

export async function listFolders({ userId, parentId }: { userId: string; parentId?: string }) {
  const folders = await prisma.folder.findMany({
    where: { userId, deletedAt: null, parentId: parentId ?? null },
    include: {
      _count: { select: { files: { where: { status: 'active' } }, children: { where: { deletedAt: null } } } },
      connectedAccount: { select: { id: true, email: true, provider: true } },
    },
    orderBy: { updatedAt: 'desc' },
  })

  return {
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      color: folder.color,
      iconUrl: folder.iconUrl,
      parentId: folder.parentId,
      provider: folder.provider,
      connectedAccount: folder.connectedAccount,
      fileCount: folder._count.files,
      childFolderCount: folder._count.children,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
    })),
  }
}

export const createFolderSchema = {
  userId: z.string().describe('The user ID creating the folder'),
  name: z.string().min(1).max(255).describe('Folder name'),
  parentId: z.string().optional().describe('Parent folder ID (omit for root folder)'),
}

export async function createFolder({ userId, name, parentId }: { userId: string; name: string; parentId?: string }) {
  if (parentId) {
    await prisma.folder.findFirstOrThrow({ where: { id: parentId, userId, deletedAt: null } })
  }

  const folder = await prisma.folder.create({
    data: { userId, name, parentId: parentId ?? null },
  })

  return {
    status: 'ok',
    folder: {
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      createdAt: folder.createdAt.toISOString(),
    },
  }
}

export const deleteFolderSchema = {
  userId: z.string().describe('The user ID'),
  folderId: z.string().describe('The folder ID to soft-delete'),
}

export async function deleteFolder({ userId, folderId }: { userId: string; folderId: string }) {
  const folder = await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } })

  await prisma.folder.update({
    where: { id: folder.id },
    data: { deletedAt: new Date() },
  })

  return { status: 'ok', deletedId: folder.id }
}

export const renameFolderSchema = {
  userId: z.string().describe('The user ID'),
  folderId: z.string().describe('The folder ID to rename'),
  name: z.string().min(1).max(255).describe('New folder name'),
}

export async function renameFolder({ userId, folderId, name }: { userId: string; folderId: string; name: string }) {
  const folder = await prisma.folder.findFirstOrThrow({ where: { id: folderId, userId, deletedAt: null } })

  const updated = await prisma.folder.update({
    where: { id: folder.id },
    data: { name },
  })

  return {
    status: 'ok',
    folder: {
      id: updated.id,
      name: updated.name,
      updatedAt: updated.updatedAt.toISOString(),
    },
  }
}
