import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { decrypt } from "../lib/encryption.js";
import { config } from "../lib/config.js";
import { google } from "googleapis";
import { randomBytes, createHash } from "crypto";

// ─── Schemas ─────────────────────────────────────────

export const listFilesSchema = z.object({
  userId: z.string().describe("ID del usuario"),
  folderId: z.string().optional().describe("Filtrar por carpeta"),
  query: z.string().optional().describe("Buscar por nombre"),
  limit: z.number().default(50).describe("Límite de resultados"),
  offset: z.number().default(0).describe("Offset para paginación"),
});

export const getFileSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
});

export const deleteFileSchema = z.object({
  fileId: z.string().describe("ID del archivo a eliminar"),
});

export const deleteFilesSchema = z.object({
  fileIds: z.array(z.string()).describe("IDs de archivos a eliminar"),
});

export const renameFileSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
  newName: z.string().describe("Nuevo nombre del archivo"),
});

export const moveFileSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
  folderId: z.string().nullable().describe("ID de la carpeta destino (null para raíz)"),
});

export const shareFileSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
  expiryHours: z.number().default(24).describe("Horas hasta expiración del enlace"),
});

export const unshareFileSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
});

export const getDownloadUrlSchema = z.object({
  fileId: z.string().describe("ID del archivo"),
});

export const syncDriveSchema = z.object({
  accountId: z.string().describe("ID de la cuenta de Google Drive"),
});

export const uploadFileSchema = z.object({
  userId: z.string().describe("ID del usuario"),
  fileName: z.string().describe("Nombre del archivo"),
  mimeType: z.string().default("application/octet-stream").describe("Tipo MIME"),
  sizeBytes: z.number().describe("Tamaño en bytes"),
  folderId: z.string().optional().describe("Carpeta destino"),
  accountId: z.string().optional().describe("Cuenta específica (si no, se usa routing policy)"),
  content: z.string().describe("Contenido del archivo en base64"),
});


// ─── Handlers ────────────────────────────────────────

export async function listFiles(params: z.infer<typeof listFilesSchema>) {
  const where: any = { userId: params.userId };
  if (params.folderId) where.folderId = params.folderId;
  if (params.query) where.fileName = { contains: params.query };

  const [files, total] = await Promise.all([
    prisma.file.findMany({
      where,
      take: params.limit,
      skip: params.offset,
      orderBy: { createdAt: "desc" },
      include: {
        folder: { select: { id: true, name: true } },
        account: { select: { id: true, label: true, provider: true } },
      },
    }),
    prisma.file.count({ where }),
  ]);

  return {
    files: files.map((f) => ({ ...f, sizeBytes: f.sizeBytes.toString() })),
    total,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function getFile(params: z.infer<typeof getFileSchema>) {
  const file = await prisma.file.findUniqueOrThrow({
    where: { id: params.fileId },
    include: {
      folder: { select: { id: true, name: true } },
      account: { select: { id: true, label: true, provider: true, email: true } },
    },
  });
  return { ...file, sizeBytes: file.sizeBytes.toString() };
}

export async function deleteFile(params: z.infer<typeof deleteFileSchema>) {
  const file = await prisma.file.findUniqueOrThrow({
    where: { id: params.fileId },
    include: { account: true },
  });

  if (file.storageProvider === "google_drive" && file.externalId) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId, config.google.clientSecret, config.google.redirectUri
      );
      oauth2Client.setCredentials({
        access_token: file.account.accessToken ? decrypt(file.account.accessToken) : undefined,
        refresh_token: file.account.refreshToken ? decrypt(file.account.refreshToken) : undefined,
      });
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      await drive.files.delete({ fileId: file.externalId });
    } catch (err: any) {
      console.error("Error eliminando de Drive:", err.message);
    }
  }

  await prisma.file.delete({ where: { id: params.fileId } });
  return { message: `Archivo "${file.fileName}" eliminado` };
}

export async function deleteFiles(params: z.infer<typeof deleteFilesSchema>) {
  const results: string[] = [];
  for (const fileId of params.fileIds) {
    try {
      const result = await deleteFile({ fileId });
      results.push(result.message);
    } catch (err: any) {
      results.push(`Error con ${fileId}: ${err.message}`);
    }
  }
  return { results };
}


export async function renameFile(params: z.infer<typeof renameFileSchema>) {
  const file = await prisma.file.findUniqueOrThrow({
    where: { id: params.fileId },
    include: { account: true },
  });

  if (file.storageProvider === "google_drive" && file.externalId) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId, config.google.clientSecret, config.google.redirectUri
      );
      oauth2Client.setCredentials({
        access_token: file.account.accessToken ? decrypt(file.account.accessToken) : undefined,
        refresh_token: file.account.refreshToken ? decrypt(file.account.refreshToken) : undefined,
      });
      const drive = google.drive({ version: "v3", auth: oauth2Client });
      await drive.files.update({ fileId: file.externalId, requestBody: { name: params.newName } });
    } catch (err: any) {
      console.error("Error renombrando en Drive:", err.message);
    }
  }

  const updated = await prisma.file.update({
    where: { id: params.fileId },
    data: { fileName: params.newName },
  });

  return { message: `Archivo renombrado a "${params.newName}"`, file: { ...updated, sizeBytes: updated.sizeBytes.toString() } };
}

export async function moveFile(params: z.infer<typeof moveFileSchema>) {
  const updated = await prisma.file.update({
    where: { id: params.fileId },
    data: { folderId: params.folderId },
  });
  return { message: `Archivo movido`, fileId: updated.id, folderId: params.folderId };
}

export async function shareFile(params: z.infer<typeof shareFileSchema>) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + params.expiryHours);

  await prisma.file.update({
    where: { id: params.fileId },
    data: { shareToken: tokenHash, shareExpiry: expiry, isShared: true },
  });

  return {
    shareToken: token,
    expiresAt: expiry.toISOString(),
    message: `Enlace compartido creado (expira en ${params.expiryHours}h)`,
  };
}

export async function unshareFile(params: z.infer<typeof unshareFileSchema>) {
  await prisma.file.update({
    where: { id: params.fileId },
    data: { shareToken: null, shareExpiry: null, isShared: false },
  });
  return { message: "Enlace compartido revocado" };
}

export async function getDownloadUrl(params: z.infer<typeof getDownloadUrlSchema>) {
  const file = await prisma.file.findUniqueOrThrow({
    where: { id: params.fileId },
    include: { account: true },
  });

  if (file.storageProvider === "google_drive" && file.externalId) {
    return {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      externalUrl: `https://drive.google.com/uc?id=${file.externalId}&export=download`,
      message: "URL de descarga generada",
    };
  }

  if (file.storageProvider === "s3") {
    return {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      externalUrl: file.externalUrl,
      message: "URL de descarga S3",
    };
  }

  return { message: "Proveedor no soportado" };
}


export async function syncDrive(params: z.infer<typeof syncDriveSchema>) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({
    where: { id: params.accountId },
  });

  if (account.provider !== "google_drive") {
    return { message: "Solo se puede sincronizar cuentas de Google Drive" };
  }

  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId, config.google.clientSecret, config.google.redirectUri
  );
  oauth2Client.setCredentials({
    access_token: account.accessToken ? decrypt(account.accessToken) : undefined,
    refresh_token: account.refreshToken ? decrypt(account.refreshToken) : undefined,
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  const folderId = account.driveRootFolderId;
  if (!folderId) return { message: "No se encontró la carpeta 9drive en esta cuenta" };

  let allFiles: any[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size,webViewLink)",
      pageSize: 100,
      pageToken,
    });
    if (res.data.files) allFiles = allFiles.concat(res.data.files);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  const existingFiles = await prisma.file.findMany({
    where: { accountId: params.accountId },
    select: { externalId: true },
  });
  const existingIds = new Set(existingFiles.map((f) => f.externalId));

  let added = 0;
  for (const driveFile of allFiles) {
    if (!existingIds.has(driveFile.id)) {
      await prisma.file.create({
        data: {
          userId: account.userId,
          accountId: account.id,
          fileName: driveFile.name || "sin-nombre",
          mimeType: driveFile.mimeType || "application/octet-stream",
          sizeBytes: BigInt(driveFile.size || "0"),
          externalId: driveFile.id,
          externalUrl: driveFile.webViewLink || null,
          storageProvider: "google_drive",
        },
      });
      added++;
    }
  }

  return {
    totalInDrive: allFiles.length,
    newFilesAdded: added,
    message: `Sincronización completada: ${added} archivos nuevos agregados`,
  };
}

export async function uploadFile(params: z.infer<typeof uploadFileSchema>) {
  let account;

  if (params.accountId) {
    account = await prisma.connectedAccount.findUniqueOrThrow({
      where: { id: params.accountId },
    });
  } else {
    account = await selectAccountByPolicy(params.userId, params.sizeBytes);
  }

  if (!account) return { error: "No hay cuentas conectadas con espacio disponible" };

  const fileBuffer = Buffer.from(params.content, "base64");

  if (account.provider === "google_drive") {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId, config.google.clientSecret, config.google.redirectUri
    );
    oauth2Client.setCredentials({
      access_token: account.accessToken ? decrypt(account.accessToken) : undefined,
      refresh_token: account.refreshToken ? decrypt(account.refreshToken) : undefined,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const { Readable } = await import("stream");

    const driveFile = await drive.files.create({
      requestBody: {
        name: params.fileName,
        parents: account.driveRootFolderId ? [account.driveRootFolderId] : [],
      },
      media: { mimeType: params.mimeType, body: Readable.from(fileBuffer) },
      fields: "id,name,webViewLink,size",
    });

    const file = await prisma.file.create({
      data: {
        userId: params.userId,
        accountId: account.id,
        folderId: params.folderId || null,
        fileName: params.fileName,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        externalId: driveFile.data.id || null,
        externalUrl: driveFile.data.webViewLink || null,
        storageProvider: "google_drive",
      },
    });

    return {
      fileId: file.id,
      externalId: driveFile.data.id,
      account: account.label,
      message: `Archivo "${params.fileName}" subido a Google Drive (${account.label})`,
    };
  }

  if (account.provider === "s3") {
    const { uploadToS3 } = await import("../services/s3.js");
    const result = await uploadToS3(account, fileBuffer, params.fileName, params.mimeType);

    const file = await prisma.file.create({
      data: {
        userId: params.userId,
        accountId: account.id,
        folderId: params.folderId || null,
        fileName: params.fileName,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        externalId: result.key,
        externalUrl: result.url || null,
        storageProvider: "s3",
      },
    });

    return {
      fileId: file.id,
      externalId: result.key,
      account: account.label,
      message: `Archivo "${params.fileName}" subido a S3 (${account.label})`,
    };
  }

  return { error: "Proveedor no soportado" };
}

// ─── Routing Policy ──────────────────────────────────

async function selectAccountByPolicy(userId: string, sizeBytes: number) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, isActive: true },
    orderBy: { priority: "asc" },
  });

  if (accounts.length === 0) return null;

  switch (config.upload.policy) {
    case "most-available": {
      let best = accounts[0];
      let bestFree = BigInt(0);
      for (const acc of accounts) {
        if (acc.quotaTotal && acc.quotaUsed) {
          const free = acc.quotaTotal - acc.quotaUsed;
          if (free > bestFree) { bestFree = free; best = acc; }
        }
      }
      return best;
    }
    case "round-robin": {
      const counts = await prisma.file.groupBy({
        by: ["accountId"],
        where: { userId },
        _count: { id: true },
      });
      const countMap = new Map(counts.map((c) => [c.accountId, c._count.id]));
      let min = Infinity;
      let selected = accounts[0];
      for (const acc of accounts) {
        const count = countMap.get(acc.id) || 0;
        if (count < min) { min = count; selected = acc; }
      }
      return selected;
    }
    case "priority-order": {
      for (const acc of accounts) {
        if (acc.quotaTotal && acc.quotaUsed) {
          const free = acc.quotaTotal - acc.quotaUsed;
          if (free > BigInt(sizeBytes)) return acc;
        } else {
          return acc;
        }
      }
      return accounts[0];
    }
    default:
      return accounts[0];
  }
}
