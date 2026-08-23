import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import {
  getCleanupPolicy,
  setCleanupPolicy,
  previewCleanupImpact,
  MIN_RETENTION_DAYS,
  MIN_MAX_ITEMS_PER_USER,
} from "@/server/settings/cleanup-policy";
import { runCleanupTick } from "@/server/worker";
import { env } from "@/lib/env";

/**
 * 清理策略读写（仅管理员）。
 *
 * GET  — 当前策略 + 按当前策略的影响预估
 * POST — 保存策略（`preview: true` 则只算影响不保存）
 *
 * 清理是物理删除且不可恢复，所以保存前必须让管理员看到影响面。
 */

async function requireAdminOr(requestId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 }),
    };
  }
  if (user.role !== "ADMIN") {
    return {
      error: NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 }),
    };
  }
  return { user };
}

export async function GET() {
  const requestId = crypto.randomUUID();
  const guard = await requireAdminOr(requestId);
  if (guard.error) return guard.error;

  const policy = await getCleanupPolicy();
  const impact = await previewCleanupImpact(policy);

  return NextResponse.json({
    data: {
      retentionDays: policy.retentionDays,
      maxItemsPerUser: policy.maxItemsPerUser,
      chatRetentionDays: policy.chatRetentionDays,
      failedJobRetentionDays: policy.failedJobRetentionDays,
      cleanupIntervalHours: env.CLEANUP_INTERVAL_HOURS,
      source: policy.source,
      impact,
      limits: {
        minRetentionDays: MIN_RETENTION_DAYS,
        minMaxItemsPerUser: MIN_MAX_ITEMS_PER_USER,
      },
    },
    requestId,
  });
}

const Body = z.object({
  retentionDays: z.coerce.number().int().min(MIN_RETENTION_DAYS).max(3650),
  maxItemsPerUser: z.coerce.number().int().min(MIN_MAX_ITEMS_PER_USER).max(100000),
  /** true 时只返回影响预估，不写库。前端二次确认前调一次。 */
  preview: z.boolean().optional(),
  /** true 时保存后立即跑一次清理，不等下一个 tick。 */
  runNow: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const guard = await requireAdminOr(requestId);
  if (guard.error) return guard.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: `保留天数需 ≥ ${MIN_RETENTION_DAYS}，数量上限需 ≥ ${MIN_MAX_ITEMS_PER_USER}`,
        },
        requestId,
      },
      { status: 400 },
    );
  }

  const { retentionDays, maxItemsPerUser, preview, runNow } = parsed.data;
  const impact = await previewCleanupImpact({ retentionDays, maxItemsPerUser });

  if (preview) {
    return NextResponse.json({ data: { impact, saved: false }, requestId });
  }

  await setCleanupPolicy({ retentionDays, maxItemsPerUser });

  let cleaned = null;
  if (runNow) {
    cleaned = await runCleanupTick();
  }

  return NextResponse.json({ data: { impact, saved: true, cleaned }, requestId });
}
