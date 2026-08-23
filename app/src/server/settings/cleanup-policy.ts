/**
 * 清理策略（资产 / 上传图的保留期与数量上限）。
 *
 * 两级优先级：SystemSetting（管理员在设置页配置）> env（部署时的兜底默认）。
 * 与 Provider 配置的处理方式一致，但清理策略是全局的，没有用户级。
 *
 * 资产（Asset）和上传图（Upload）共用同一对数值，各自独立计数。
 * 收藏图不豁免清理（用户明确决定）。
 */
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";

export const RETENTION_DAYS_KEY = "cleanup_retention_days";
export const MAX_ITEMS_PER_USER_KEY = "cleanup_max_items_per_user";

/** 下界：防止管理员手滑填 0 或负数导致清空全库。 */
export const MIN_RETENTION_DAYS = 1;
export const MIN_MAX_ITEMS_PER_USER = 10;

export interface CleanupPolicy {
  /** 保留天数，按 createdAt 计算。资产与上传图共用。 */
  retentionDays: number;
  /** 每用户数量上限。资产与上传图各自独立套用此值。 */
  maxItemsPerUser: number;
  /** 聊天会话保留天数（独立于资产，OPT-5 原决策 30 天）。仅 env 可配。 */
  chatRetentionDays: number;
  /** failed/canceled Job 保留天数。仅 env 可配。 */
  failedJobRetentionDays: number;
  /** 数值来源，便于设置页显示"当前用的是默认值还是你改过的值"。 */
  source: { retentionDays: "db" | "env"; maxItemsPerUser: "db" | "env" };
}

function parsePositiveInt(raw: string | undefined, min: number): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

/** 读当前生效的清理策略。DB 无值或值非法时回落到 env。 */
export async function getCleanupPolicy(): Promise<CleanupPolicy> {
  const [daysRow, maxRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: RETENTION_DAYS_KEY } }),
    prisma.systemSetting.findUnique({ where: { key: MAX_ITEMS_PER_USER_KEY } }),
  ]);

  const dbDays = parsePositiveInt(daysRow?.value, MIN_RETENTION_DAYS);
  const dbMax = parsePositiveInt(maxRow?.value, MIN_MAX_ITEMS_PER_USER);

  return {
    retentionDays: dbDays ?? env.ASSET_RETENTION_DAYS,
    maxItemsPerUser: dbMax ?? env.MAX_ASSETS_PER_USER,
    chatRetentionDays: env.CHAT_RETENTION_DAYS,
    failedJobRetentionDays: env.FAILED_JOB_RETENTION_DAYS,
    source: {
      retentionDays: dbDays === null ? "env" : "db",
      maxItemsPerUser: dbMax === null ? "env" : "db",
    },
  };
}

/** 写清理策略。调用方需先校验下界。 */
export async function setCleanupPolicy(input: {
  retentionDays: number;
  maxItemsPerUser: number;
}): Promise<void> {
  await prisma.$transaction([
    prisma.systemSetting.upsert({
      where: { key: RETENTION_DAYS_KEY },
      create: { key: RETENTION_DAYS_KEY, value: String(input.retentionDays) },
      update: { value: String(input.retentionDays) },
    }),
    prisma.systemSetting.upsert({
      where: { key: MAX_ITEMS_PER_USER_KEY },
      create: { key: MAX_ITEMS_PER_USER_KEY, value: String(input.maxItemsPerUser) },
      update: { value: String(input.maxItemsPerUser) },
    }),
  ]);
}

export interface CleanupImpact {
  assets: { total: number; willDelete: number };
  uploads: { total: number; willDelete: number };
}

/** groupBy(userId) 的结果形状。 */
export interface PerUserCount {
  userId: string;
  _count: { id: number };
}

/**
 * 逐用户模拟 tick 的两步删除（先按保留期删，再按数量上限删），求删除总数。
 *
 * 抽成纯函数便于单测：`previewCleanupImpact` 只负责取数，算法在这里。
 * 结果是下界——实际删除时会连带删微调子树，可能多于此数。
 */
export function sumWillDelete(
  perUser: PerUserCount[],
  perUserExpired: PerUserCount[],
  maxItemsPerUser: number,
): number {
  const expiredByUser = new Map(perUserExpired.map(r => [r.userId, r._count.id]));
  let willDelete = 0;
  for (const row of perUser) {
    const expired = expiredByUser.get(row.userId) ?? 0;
    // 超期的先删掉，剩下的才参与数量上限判断——顺序必须与 runCleanupTick 一致
    const remaining = row._count.id - expired;
    const excess = Math.max(0, remaining - maxItemsPerUser);
    willDelete += expired + excess;
  }
  return willDelete;
}

/**
 * 预估按给定策略执行一次清理会删掉多少条记录。
 *
 * 保存设置前展示给管理员看——清理是物理删除且不可恢复，
 * 没有这个预览，填错一位数会静默删掉几百个文件。
 *
 * 结果是下界：实际删除时会连带删微调子树，可能多于此数。
 * 计算顺序与 runCleanupTick 一致（先按保留期删，再按数量上限删）。
 */
export async function previewCleanupImpact(policy: {
  retentionDays: number;
  maxItemsPerUser: number;
}): Promise<CleanupImpact> {
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

  const [
    assetTotal,
    assetPerUser,
    assetPerUserExpired,
    uploadTotal,
    uploadPerUser,
    uploadPerUserExpired,
  ] = await Promise.all([
    prisma.asset.count(),
    prisma.asset.groupBy({ by: ["userId"], _count: { id: true } }),
    prisma.asset.groupBy({
      by: ["userId"],
      _count: { id: true },
      where: { createdAt: { lt: cutoff } },
    }),
    prisma.upload.count(),
    prisma.upload.groupBy({ by: ["userId"], _count: { id: true } }),
    prisma.upload.groupBy({
      by: ["userId"],
      _count: { id: true },
      where: { createdAt: { lt: cutoff } },
    }),
  ]);

  return {
    assets: {
      total: assetTotal,
      willDelete: sumWillDelete(assetPerUser, assetPerUserExpired, policy.maxItemsPerUser),
    },
    uploads: {
      total: uploadTotal,
      willDelete: sumWillDelete(uploadPerUser, uploadPerUserExpired, policy.maxItemsPerUser),
    },
  };
}
