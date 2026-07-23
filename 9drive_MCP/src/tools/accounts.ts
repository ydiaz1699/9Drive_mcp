import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/encryption.js";
import { config } from "../lib/config.js";
import { google } from "googleapis";

// ─── Schemas ─────────────────────────────────────────

export const listAccountsSchema = z.object({
  userId: z.string().describe("ID del usuario"),
});

export const connectGoogleDriveSchema = z.object({
  userId: z.string().describe("ID del usuario"),
  authCode: z.string().describe("Código de autorización de Google OAuth2"),
  label: z.string().optional().describe("Nombre personalizado para la cuenta"),
});

export const connectS3Schema = z.object({
  userId: z.string().describe("ID del usuario"),
  label: z.string().describe("Nombre para identificar la cuenta"),
  endpoint: z.string().describe("Endpoint S3 (ej: https://s3.amazonaws.com)"),
  accessKey: z.string().describe("Access Key ID"),
  secretKey: z.string().describe("Secret Access Key"),
  bucket: z.string().describe("Nombre del bucket"),
  region: z.string().default("us-east-1").describe("Región"),
});

export const disconnectAccountSchema = z.object({
  accountId: z.string().describe("ID de la cuenta a desconectar"),
});

export const syncQuotaSchema = z.object({
  accountId: z.string().describe("ID de la cuenta"),
});

export const getOAuthUrlSchema = z.object({
  userId: z.string().describe("ID del usuario"),
});

// ─── Handlers ────────────────────────────────────────

export async function listAccounts(params: z.infer<typeof listAccountsSchema>) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: params.userId },
    select: {
      id: true,
      provider: true,
      label: true,
      email: true,
      quotaTotal: true,
      quotaUsed: true,
      quotaUpdatedAt: true,
      priority: true,
      isActive: true,
      s3Bucket: true,
      s3Region: true,
      s3Endpoint: true,
      createdAt: true,
    },
  });

  return accounts.map((a) => ({
    ...a,
    quotaTotal: a.quotaTotal?.toString(),
    quotaUsed: a.quotaUsed?.toString(),
    quotaFreeBytes:
      a.quotaTotal && a.quotaUsed
        ? (a.quotaTotal - a.quotaUsed).toString()
        : null,
    s3Endpoint: a.s3Endpoint ? decrypt(a.s3Endpoint) : null,
  }));
}

export async function getOAuthUrl(params: z.infer<typeof getOAuthUrlSchema>) {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  const scopes = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent",
    state: params.userId,
  });

  return { url, message: "Abre esta URL en tu navegador para autorizar Google Drive" };
}

export async function connectGoogleDrive(
  params: z.infer<typeof connectGoogleDriveSchema>
) {
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );

  const { tokens } = await oauth2Client.getToken(params.authCode);
  oauth2Client.setCredentials(tokens);

  // Obtener info del usuario
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  // Obtener o crear carpeta 9drive en Drive
  const drive = google.drive({ version: "v3", auth: oauth2Client });
  let rootFolderId: string | null = null;

  const folderSearch = await drive.files.list({
    q: "name='9drive' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id,name)",
    spaces: "drive",
  });

  if (folderSearch.data.files && folderSearch.data.files.length > 0) {
    rootFolderId = folderSearch.data.files[0].id || null;
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: "9drive",
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    rootFolderId = folder.data.id || null;
  }

  // Obtener cuota
  const about = await drive.about.get({ fields: "storageQuota" });
  const quota = about.data.storageQuota;

  const account = await prisma.connectedAccount.create({
    data: {
      userId: params.userId,
      provider: "google_drive",
      label: params.label || userInfo.data.email || "Google Drive",
      email: userInfo.data.email || undefined,
      accessToken: encrypt(tokens.access_token || ""),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      driveRootFolderId: rootFolderId,
      quotaTotal: quota?.limit ? BigInt(quota.limit) : null,
      quotaUsed: quota?.usage ? BigInt(quota.usage) : null,
      quotaUpdatedAt: new Date(),
    },
  });

  return {
    id: account.id,
    email: account.email,
    label: account.label,
    message: `Cuenta de Google Drive conectada: ${account.email}`,
  };
}

export async function connectS3(params: z.infer<typeof connectS3Schema>) {
  const account = await prisma.connectedAccount.create({
    data: {
      userId: params.userId,
      provider: "s3",
      label: params.label,
      s3Endpoint: encrypt(params.endpoint),
      s3AccessKey: encrypt(params.accessKey),
      s3SecretKey: encrypt(params.secretKey),
      s3Bucket: params.bucket,
      s3Region: params.region,
      isActive: true,
    },
  });

  return {
    id: account.id,
    label: account.label,
    provider: "s3",
    bucket: params.bucket,
    message: `Cuenta S3 conectada: ${params.label}`,
  };
}

export async function disconnectAccount(
  params: z.infer<typeof disconnectAccountSchema>
) {
  await prisma.connectedAccount.delete({
    where: { id: params.accountId },
  });

  return { message: "Cuenta desconectada exitosamente" };
}

export async function syncQuota(params: z.infer<typeof syncQuotaSchema>) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({
    where: { id: params.accountId },
  });

  if (account.provider === "google_drive") {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
      config.google.redirectUri
    );

    oauth2Client.setCredentials({
      access_token: account.accessToken ? decrypt(account.accessToken) : undefined,
      refresh_token: account.refreshToken ? decrypt(account.refreshToken) : undefined,
    });

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const about = await drive.about.get({ fields: "storageQuota" });
    const quota = about.data.storageQuota;

    await prisma.connectedAccount.update({
      where: { id: params.accountId },
      data: {
        quotaTotal: quota?.limit ? BigInt(quota.limit) : null,
        quotaUsed: quota?.usage ? BigInt(quota.usage) : null,
        quotaUpdatedAt: new Date(),
      },
    });

    return {
      quotaTotal: quota?.limit,
      quotaUsed: quota?.usage,
      quotaFree:
        quota?.limit && quota?.usage
          ? (BigInt(quota.limit) - BigInt(quota.usage)).toString()
          : null,
      message: "Cuota sincronizada",
    };
  }

  return {
    quotaTotal: account.quotaTotal?.toString(),
    quotaUsed: account.quotaUsed?.toString(),
    message: "S3 no reporta cuota nativa",
  };
}
