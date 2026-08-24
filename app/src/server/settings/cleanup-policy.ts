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
 * 只适用于**没有子树**的实体（当前是 Upload）：删一条就是一条，不会连带。
 * 资产（Asset）有微调子树，删父连带删子，必须走 `planAssetCleanup`。
 *
 * 抽成纯函数便于单测：`previewCleanupImpact` 只负责取数，算法在这里。
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

// ── 资产清理规划（含微调子树）──

/** 清理规划的输入：资产的最小投影。 */
export interface AssetLite {
  id: string;
  userId: string;
  parentAssetId: string | null;
  createdAt: Date;
}

export interface AssetCleanupPlan {
  /** 全部待删 id（含被连带的微调子树节点）。 */
  doomed: Set<string>;
  /** 因超过保留期被删的数量（含连带子树）。 */
  expiredCount: number;
  /** 因超过每用户数量上限被删的数量（含连带子树）。 */
  excessCount: number;
}

/**
 * 规划一次资产清理：算出会被删除的全部资产 id。
 *
 * **执行（worker tick）与预览（管理员二次确认）必须共用此函数。**
 * 两边分开实现必然漂移——旧代码就是执行时按"取 N 个最老的再各自展开子树"
 * 实际删了远超 N 张，而预览只报 N，管理员在错误预期下按下了确定。
 *
 * 两阶段，顺序即语义：
 *   ① 超期：`createdAt < cutoff` 的资产连同其微调子树一并删。
 *      子图可能比 cutoff 新，但父图已删，留着孤立子图没有意义。
 *   ② 超额：仍超过每用户上限时，从最老的根资产开始整棵删，
 *      **每删一棵重新判断是否已降到上限内**。
 *
 * 子树是原子单位，所以最终删除量可能略超"超出上限的张数"
 * （上界为最后那棵子树的大小 - 1）。微调深度上限为 3、每次产出 1 张，
 * 现实中子树是个位数规模，这个误差可接受；重要的是预览与执行**报同一个数**。
 */
export function planAssetCleanup(
  assets: AssetLite[],
  opts: { cutoff: Date; maxItemsPerUser: number },
): AssetCleanupPlan {
  const childrenOf = new Map<string, string[]>();
  for (const a of assets) {
    if (!a.parentAssetId) continue;
    const siblings = childrenOf.get(a.parentAssetId);
    if (siblings) siblings.push(a.id);
    else childrenOf.set(a.parentAssetId, [a.id]);
  }

  const doomed = new Set<string>();

  /** 标记 id 及其全部后代为待删，返回本次新增的节点数。 */
  function doomSubtree(id: string): number {
    if (doomed.has(id)) return 0;
    let added = 0;
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (doomed.has(cur)) continue;
      doomed.add(cur);
      added++;
      const kids = childrenOf.get(cur);
      if (kids) stack.push(...kids);
    }
    return added;
  }

  // ① 超期（含连带子树）
  const cutoffMs = opts.cutoff.getTime();
  let expiredCount = 0;
  for (const a of assets) {
    if (a.createdAt.getTime() < cutoffMs) expiredCount += doomSubtree(a.id);
  }

  // ② 超额，按用户独立结算
  const byUser = new Map<string, AssetLite[]>();
  for (const a of assets) {
    const owned = byUser.get(a.userId);
    if (owned) owned.push(a);
    else byUser.set(a.userId, [a]);
  }

  let excessCount = 0;
  for (const owned of byUser.values()) {
    let alive = owned.reduce((n, a) => (doomed.has(a.id) ? n : n + 1), 0);
    if (alive <= opts.maxItemsPerUser) continue;

    // 只从根资产下手。删中间节点会留下"父还在、子没了"的断枝，
    // 而删根是整棵移除，语义干净。第 ① 步删的也是整棵子树，
    // 所以存活资产里不存在父已删而子存活的孤立节点。
    const roots = owned
      .filter((a) => !doomed.has(a.id) && !a.parentAssetId)
      .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

    for (const root of roots) {
      if (alive <= opts.maxItemsPerUser) break;
      const removed = doomSubtree(root.id);
      alive -= removed;
      excessCount += removed;
    }
  }

  return { doomed, expiredCount, excessCount };
}

/**
 * 预估按给定策略执行一次清理会删掉多少条记录。
 *
 * 保存设置前展示给管理员看——清理是物理删除且不可恢复，
 * 没有这个预览，填错一位数会静默删掉几百个文件。
 *
 * 资产走 `planAssetCleanup`（与 worker 执行时同一函数，数字必然一致）；
 * 上传图无子树，走 `sumWillDelete`。
 */
export async function previewCleanupImpact(policy: {
  retentionDays: number;
  maxItemsPerUser: number;
}): Promise<CleanupImpact> {
  const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);

  const [assets, uploadTotal, uploadPerUser, uploadPerUserExpired] = await Promise.all([
    prisma.asset.findMany({
      select: { id: true, userId: true, parentAssetId: true, createdAt: true },
    }),
    prisma.upload.count(),
    prisma.upload.groupBy({ by: ["userId"], _count: { id: true } }),
    prisma.upload.groupBy({
      by: ["userId"],
      _count: { id: true },
      where: { createdAt: { lt: cutoff } },
    }),
  ]);

  const plan = planAssetCleanup(assets, { cutoff, maxItemsPerUser: policy.maxItemsPerUser });

  return {
    assets: {
      total: assets.length,
      willDelete: plan.doomed.size,
    },
    uploads: {
      total: uploadTotal,
      willDelete: sumWillDelete(uploadPerUser, uploadPerUserExpired, policy.maxItemsPerUser),
    },
  };
}
