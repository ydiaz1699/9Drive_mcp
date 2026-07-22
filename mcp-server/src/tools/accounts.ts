import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { syncGoogleQuota } from '../lib/google.js'
import { syncS3Quota } from '../lib/s3.js'

export const listAccountsSchema = {
  userId: z.string().describe('The user ID to list connected accounts for'),
}

export async function listAccounts({ userId }: { userId: string }) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: 'connected' },
    include: { storageAccount: true },
    orderBy: { createdAt: 'desc' },
  })

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      email: account.email,
      displayName: account.displayName,
      status: account.status,
      createdAt: account.createdAt.toISOString(),
      storage: account.storageAccount
        ? {
            totalBytes: account.storageAccount.totalBytes?.toString() ?? null,
            usedBytes: account.storageAccount.usedBytes.toString(),
            availableBytes: account.storageAccount.availableBytes?.toString() ?? null,
            lastSyncedAt: account.storageAccount.lastSyncedAt?.toISOString() ?? null,
          }
        : null,
    })),
  }
}

export const syncAccountQuotaSchema = {
  accountId: z.string().describe('The connected account ID to sync quota for'),
}

export async function syncAccountQuota({ accountId }: { accountId: string }) {
  const account = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: accountId } })

  if (account.provider === 'google_drive') {
    const result = await syncGoogleQuota(accountId)
    return {
      status: 'ok',
      storage: {
        totalBytes: result.totalBytes?.toString() ?? null,
        usedBytes: result.usedBytes.toString(),
        availableBytes: result.availableBytes?.toString() ?? null,
        lastSyncedAt: result.lastSyncedAt?.toISOString() ?? null,
      },
    }
  } else if (account.provider === 's3') {
    const result = await syncS3Quota(accountId)
    return {
      status: 'ok',
      storage: {
        totalBytes: result.totalBytes?.toString() ?? null,
        usedBytes: result.usedBytes.toString(),
        availableBytes: result.availableBytes?.toString() ?? null,
        lastSyncedAt: result.lastSyncedAt?.toISOString() ?? null,
      },
    }
  }

  return { status: 'error', message: `Unsupported provider: ${account.provider}` }
}

export const storageSummarySchema = {
  userId: z.string().describe('The user ID to get storage summary for'),
}

export async function storageSummary({ userId }: { userId: string }) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, status: 'connected' },
    include: { storageAccount: true },
  })

  let totalBytes = 0n
  let usedBytes = 0n
  let availableBytes = 0n
  let accountsWithStorage = 0

  for (const account of accounts) {
    if (account.storageAccount) {
      accountsWithStorage++
      if (account.storageAccount.totalBytes) totalBytes += account.storageAccount.totalBytes
      usedBytes += account.storageAccount.usedBytes
      if (account.storageAccount.availableBytes) availableBytes += account.storageAccount.availableBytes
    }
  }

  return {
    totalAccounts: accounts.length,
    accountsWithStorage,
    totalBytes: totalBytes.toString(),
    usedBytes: usedBytes.toString(),
    availableBytes: availableBytes.toString(),
    usagePercent: totalBytes > 0n ? Number((usedBytes * 100n) / totalBytes) : null,
  }
}
