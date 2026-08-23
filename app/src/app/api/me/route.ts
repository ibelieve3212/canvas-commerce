import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getOrCreateQuota } from "@/server/generation/service";

/** GET /api/me — 当前用户信息和配额 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const quota = await getOrCreateQuota(user.id);

  return NextResponse.json({
    data: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      quota: {
        dailyLimit: quota.dailyLimit,
        dailyUsed: quota.dailyUsed,
        totalQuota: quota.totalQuota,
        totalUsed: quota.totalUsed,
        remaining: Math.max(0, quota.totalQuota - quota.totalUsed),
        dailyRemaining: Math.max(0, quota.dailyLimit - quota.dailyUsed),
      },
    },
    requestId,
  });
}
