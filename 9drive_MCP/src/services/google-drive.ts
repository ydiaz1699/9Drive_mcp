/**
 * 9Drive MCP - Servicio de Google Drive
 * Acceso directo a la API de Google Drive v3
 */
import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Readable } from "stream";
import { config } from "../lib/config.js";
import { decrypt, encrypt } from "../lib/encryption.js";
import { prisma } from "../lib/prisma.js";

// ─── Crear cliente OAuth2 ────────────────────────────

export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Obtener cliente autenticado para una cuenta conectada.
 * Refresca el token si está expirado y lo actualiza en DB.
 */
export async function getAuthenticatedClient(
  accountId: string
): Promise<{ client: OAuth2Client; drive: drive_v3.Drive }> {
  const account = await prisma.connectedAccount.findUniqueOrThrow({
    where: { id: accountId },
  });

  if (account.provider !== "google_drive") {
    throw new Error("La cuenta no es de Google Drive");
  }

  const oauth2Client = createOAuth2Client();

  const accessToken = account.accessToken ? decrypt(account.accessToken) : "";
  const refreshToken = account.refreshToken ? decrypt(account.refreshToken) : "";

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiry?.getTime(),
  });

  // Listener para actualizar tokens cuando se refrescan
  oauth2Client.on("tokens", async (tokens) => {
    const updateData: any = {};
    if (tokens.access_token) {
      updateData.accessToken = encrypt(tokens.access_token);
    }
    if (tokens.refresh_token) {
      updateData.refreshToken = encrypt(tokens.refresh_token);
    }
    if (tokens.expiry_date) {
      updateData.tokenExpiry = new Date(tokens.expiry_date);
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.connectedAccount.update({
        where: { id: accountId },
        data: updateData,
      });
    }
  });

  // Forzar refresh si el token está expirado
  if (account.tokenExpiry && account.tokenExpiry < new Date()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
  }

  const drive = google.drive({ version: "v3", auth: oauth2Client });
  return { client: oauth2Client, drive };
}

/**
 * Asegurar que existe la carpeta "9drive" en la raíz de Drive.
 */
export async function ensureRootFolder(accountId: string): Promise<string> {
  const account = await prisma.connectedAccount.findUniqueOrThrow({
    where: { id: accountId },
  });

  if (account.driveRootFolderId) {
    return account.driveRootFolderId;
  }

  const { drive } = await getAuthenticatedClient(accountId);

  const search = await drive.files.list({
    q: "name='9drive' and mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents",
    fields: "files(id,name)",
    spaces: "drive",
  });

  let folderId: string;

  if (search.data.files && search.data.files.length > 0) {
    folderId = search.data.files[0].id!;
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: "9drive",
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    folderId = folder.data.id!;
  }

  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { driveRootFolderId: folderId },
  });

  return folderId;
}

/**
 * Subir archivo a Google Drive (streaming desde buffer).
 */
export async function uploadToDrive(
  accountId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ id: string; webViewLink: string | null }> {
  const { drive } = await getAuthenticatedClient(accountId);
  const rootFolderId = await ensureRootFolder(accountId);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [rootFolderId],
    },
    media: {
      mimeType,
      body: Readable.from(fileBuffer),
    },
    fields: "id,webViewLink",
  });

  return {
    id: response.data.id || "",
    webViewLink: response.data.webViewLink || null,
  };
}

/**
 * Descargar archivo de Google Drive como stream.
 */
export async function downloadFromDrive(
  accountId: string,
  externalId: string
): Promise<{ stream: Readable; mimeType: string; size: number }> {
  const { drive } = await getAuthenticatedClient(accountId);

  const meta = await drive.files.get({
    fileId: externalId,
    fields: "mimeType,size,name",
  });

  const response = await drive.files.get(
    { fileId: externalId, alt: "media" },
    { responseType: "stream" }
  );

  return {
    stream: response.data as unknown as Readable,
    mimeType: meta.data.mimeType || "application/octet-stream",
    size: parseInt(meta.data.size || "0", 10),
  };
}

/**
 * Eliminar archivo de Google Drive.
 */
export async function deleteFromDrive(
  accountId: string,
  externalId: string
): Promise<void> {
  const { drive } = await getAuthenticatedClient(accountId);
  await drive.files.delete({ fileId: externalId });
}

/**
 * Renombrar archivo en Google Drive.
 */
export async function renameInDrive(
  accountId: string,
  externalId: string,
  newName: string
): Promise<void> {
  const { drive } = await getAuthenticatedClient(accountId);
  await drive.files.update({
    fileId: externalId,
    requestBody: { name: newName },
  });
}

/**
 * Listar archivos en la carpeta 9drive de una cuenta.
 */
export async function listDriveFiles(accountId: string): Promise<
  Array<{
    id: string;
    name: string;
    mimeType: string;
    size: string;
    webViewLink: string | null;
    createdTime: string | null;
  }>
> {
  const { drive } = await getAuthenticatedClient(accountId);
  const rootFolderId = await ensureRootFolder(accountId);

  let allFiles: any[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${rootFolderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,size,webViewLink,createdTime)",
      pageSize: 100,
      pageToken,
    });

    if (res.data.files) {
      allFiles = allFiles.concat(res.data.files);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles.map((f) => ({
    id: f.id || "",
    name: f.name || "sin-nombre",
    mimeType: f.mimeType || "application/octet-stream",
    size: f.size || "0",
    webViewLink: f.webViewLink || null,
    createdTime: f.createdTime || null,
  }));
}

/**
 * Obtener cuota de almacenamiento de una cuenta.
 */
export async function getDriveQuota(accountId: string): Promise<{
  limit: string;
  usage: string;
  usageInDrive: string;
  usageInTrash: string;
}> {
  const { drive } = await getAuthenticatedClient(accountId);

  const about = await drive.about.get({ fields: "storageQuota" });
  const quota = about.data.storageQuota;

  return {
    limit: quota?.limit || "0",
    usage: quota?.usage || "0",
    usageInDrive: quota?.usageInDrive || "0",
    usageInTrash: quota?.usageInTrash || "0",
  };
}
