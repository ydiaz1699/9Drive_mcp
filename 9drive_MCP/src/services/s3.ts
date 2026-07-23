/**
 * 9Drive MCP - Servicio S3 Compatible
 * Soporta: AWS S3, MinIO, Cloudflare R2, Wasabi, Backblaze B2
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import { decrypt } from "../lib/encryption.js";
import type { ConnectedAccount } from "@prisma/client";

// ─── Tipos ───────────────────────────────────────────

export interface S3UploadResult {
  key: string;
  url: string | null;
  bucket: string;
}

export interface S3FileInfo {
  key: string;
  size: number;
  lastModified: Date | null;
  etag: string | null;
}

// ─── Crear cliente S3 ────────────────────────────────

export function createS3Client(account: ConnectedAccount): S3Client {
  if (!account.s3Endpoint || !account.s3AccessKey || !account.s3SecretKey) {
    throw new Error("Cuenta S3 incompleta: faltan credenciales");
  }

  const endpoint = decrypt(account.s3Endpoint);
  const accessKeyId = decrypt(account.s3AccessKey);
  const secretAccessKey = decrypt(account.s3SecretKey);

  return new S3Client({
    endpoint,
    region: account.s3Region || "us-east-1",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

// ─── Verificar conexión ──────────────────────────────

export async function testS3Connection(
  account: ConnectedAccount
): Promise<{ ok: boolean; message: string }> {
  try {
    const client = createS3Client(account);
    await client.send(new HeadBucketCommand({ Bucket: account.s3Bucket || "" }));
    return { ok: true, message: "Conexión S3 exitosa" };
  } catch (err: any) {
    return { ok: false, message: `Error S3: ${err.message}` };
  }
}

// ─── Subir archivo ───────────────────────────────────

export async function uploadToS3(
  account: ConnectedAccount,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<S3UploadResult> {
  const client = createS3Client(account);
  const bucket = account.s3Bucket || "";

  const key = `9drive/${Date.now()}-${fileName}`;

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    },
  });

  await upload.done();

  const endpoint = decrypt(account.s3Endpoint!);
  const url = `${endpoint}/${bucket}/${key}`;

  return { key, url, bucket };
}

// ─── Descargar archivo ───────────────────────────────

export async function downloadFromS3(
  account: ConnectedAccount,
  key: string
): Promise<{ stream: Readable; contentType: string; size: number }> {
  const client = createS3Client(account);
  const bucket = account.s3Bucket || "";

  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  return {
    stream: response.Body as Readable,
    contentType: response.ContentType || "application/octet-stream",
    size: response.ContentLength || 0,
  };
}

// ─── Eliminar archivo ────────────────────────────────

export async function deleteFromS3(
  account: ConnectedAccount,
  key: string
): Promise<void> {
  const client = createS3Client(account);
  const bucket = account.s3Bucket || "";

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ─── Listar archivos ─────────────────────────────────

export async function listS3Files(
  account: ConnectedAccount,
  prefix: string = "9drive/"
): Promise<S3FileInfo[]> {
  const client = createS3Client(account);
  const bucket = account.s3Bucket || "";

  let allFiles: S3FileInfo[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        allFiles.push({
          key: obj.Key || "",
          size: obj.Size || 0,
          lastModified: obj.LastModified || null,
          etag: obj.ETag || null,
        });
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return allFiles;
}

// ─── Obtener uso de espacio (aprox) ──────────────────

export async function getS3Usage(
  account: ConnectedAccount
): Promise<{ totalBytes: bigint; fileCount: number }> {
  const files = await listS3Files(account);
  let totalBytes = BigInt(0);

  for (const f of files) {
    totalBytes += BigInt(f.size);
  }

  return { totalBytes, fileCount: files.length };
}
