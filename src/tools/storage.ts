import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// ─── Schemas ─────────────────────────────────────────

export const storageSummarySchema = z.object({
  userId: z.string().describe("ID del usuario"),
});

// ─── Handlers ────────────────────────────────────────

export async function storageSummary(
  params: z.infer<typeof storageSummarySchema>
) {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: params.userId, isActive: true },
    select: {
      id: true,
      provider: true,
      label: true,
      email: true,
      quotaTotal: true,
      quotaUsed: true,
      quotaUpdatedAt: true,
      s3Bucket: true,
    },
  });

  let totalQuota = BigInt(0);
  let totalUsed = BigInt(0);

  const details = accounts.map((a) => {
    const qt = a.quotaTotal || BigInt(0);
    const qu = a.quotaUsed || BigInt(0);
    totalQuota += qt;
    totalUsed += qu;

    return {
      id: a.id,
      provider: a.provider,
      label: a.label,
      email: a.email,
      bucket: a.s3Bucket,
      quotaTotal: qt.toString(),
      quotaUsed: qu.toString(),
      quotaFree: (qt - qu).toString(),
      quotaUsedPercent: qt > BigInt(0) ? Number((qu * BigInt(100)) / qt) : 0,
      lastUpdated: a.quotaUpdatedAt,
    };
  });

  const fileCount = await prisma.file.count({
    where: { userId: params.userId },
  });

  return {
    accounts: details,
    totals: {
      totalQuota: totalQuota.toString(),
      totalUsed: totalUsed.toString(),
      totalFree: (totalQuota - totalUsed).toString(),
      totalUsedPercent:
        totalQuota > BigInt(0)
          ? Number((totalUsed * BigInt(100)) / totalQuota)
          : 0,
      accountCount: accounts.length,
      fileCount,
    },
  };
}
