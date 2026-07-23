import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// ─── Schemas ─────────────────────────────────────────

export const listFoldersSchema = z.object({
  userId: z.string().describe("ID del usuario"),
  parentId: z.string().optional().describe("ID de la carpeta padre (null=raíz)"),
});

export const createFolderSchema = z.object({
  userId: z.string().describe("ID del usuario"),
  name: z.string().describe("Nombre de la carpeta"),
  parentId: z.string().optional().describe("ID carpeta padre"),
});

export const deleteFolderSchema = z.object({
  folderId: z.string().describe("ID de la carpeta a eliminar"),
});

export const renameFolderSchema = z.object({
  folderId: z.string().describe("ID de la carpeta"),
  newName: z.string().describe("Nuevo nombre"),
});

// ─── Handlers ────────────────────────────────────────

export async function listFolders(params: z.infer<typeof listFoldersSchema>) {
  const folders = await prisma.folder.findMany({
    where: {
      userId: params.userId,
      parentId: params.parentId || null,
    },
    include: {
      _count: { select: { children: true, files: true } },
    },
    orderBy: { name: "asc" },
  });

  return folders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    childrenCount: f._count.children,
    filesCount: f._count.files,
    createdAt: f.createdAt,
  }));
}

export async function createFolder(params: z.infer<typeof createFolderSchema>) {
  const folder = await prisma.folder.create({
    data: {
      userId: params.userId,
      name: params.name,
      parentId: params.parentId || null,
    },
  });

  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    message: `Carpeta "${params.name}" creada`,
  };
}

export async function deleteFolder(params: z.infer<typeof deleteFolderSchema>) {
  const folder = await prisma.folder.findUniqueOrThrow({
    where: { id: params.folderId },
    include: { _count: { select: { files: true, children: true } } },
  });

  await prisma.file.updateMany({
    where: { folderId: params.folderId },
    data: { folderId: null },
  });

  await prisma.folder.updateMany({
    where: { parentId: params.folderId },
    data: { parentId: null },
  });

  await prisma.folder.delete({ where: { id: params.folderId } });

  return { message: `Carpeta "${folder.name}" eliminada` };
}

export async function renameFolder(params: z.infer<typeof renameFolderSchema>) {
  const folder = await prisma.folder.update({
    where: { id: params.folderId },
    data: { name: params.newName },
  });

  return {
    id: folder.id,
    name: folder.name,
    message: `Carpeta renombrada a "${params.newName}"`,
  };
}
