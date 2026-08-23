import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { listAssets } from "@/server/generation/queries";
import { getCleanupPolicy } from "@/server/settings/cleanup-policy";

/** GET /api/assets — 获取资产列表（支持筛选/分页） */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const url = new URL(req.url);
  const batchId = url.searchParams.get("batchId") ?? undefined;
  const favoriteOnly = url.searchParams.get("favorite") === "true";
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "24", 10);

  // 容量提示要显示当前生效的阈值，不能在前端硬编码
  // （管理员可在设置页调整，改完即时生效）
  const [result, policy] = await Promise.all([
    listAssets(user.id, { batchId, favoriteOnly, page, pageSize }),
    getCleanupPolicy(),
  ]);

  return NextResponse.json({
    data: {
      ...result,
      policy: {
        retentionDays: policy.retentionDays,
        maxItemsPerUser: policy.maxItemsPerUser,
      },
    },
    requestId,
  });
}
