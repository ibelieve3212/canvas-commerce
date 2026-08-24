import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import {
  listAssetsForAdmin,
  getStorageOverviewForAdmin,
  hardDeleteAssetsForAdmin,
} from "@/server/generation/queries";

/** GET /api/admin/storage
 *
 * 管理员视角的资产列表（跨用户），支持按用户、时间范围筛选。
 *
 * 查询参数：
 *   userId         - 可选，限定某用户
 *   olderThanDays  - 可选，只返回 N 天前创建的资产
 *   page / pageSize - 分页
 *
 * 不带任何参数时返回存储概览 + 第一页资产。
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "未登录" }, requestId }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "需要管理员权限" }, requestId }, { status: 403 });
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId") || undefined;
  const olderThanDaysRaw = url.searchParams.get("olderThanDays");
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "24", 10);

  let createdBefore: Date | undefined;
  if (olderThanDaysRaw) {
    const days = parseInt(olderThanDaysRaw, 10);
    if (Number.isFinite(days) && days > 0) {
      createdBefore = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }
  }

  const [list, overview] = await Promise.all([
    listAssetsForAdmin({ userId, createdBefore, page, pageSize }),
    getStorageOverviewForAdmin(),
  ]);

  return NextResponse.json({ data: { ...list, overview }, requestId });
}

const DeleteBody = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(500),
});

/** DELETE /api/admin/storage — 批量删除资产（跨用户，含微调子树 + 文件）。
 *  单次最多 500 条，防误删全库。 */
export async function DELETE(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "未登录" }, requestId }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "需要管理员权限" }, requestId }, { status: 403 });
  }

  try {
    const json = await req.json();
    const parsed = DeleteBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: parsed.error.message }, requestId },
        { status: 400 },
      );
    }

    const result = await hardDeleteAssetsForAdmin(parsed.data.assetIds);
    console.log(`[admin/storage] 管理员 ${user.username} 批量删除 ${result.deletedCount} 项资产`);
    return NextResponse.json({ data: result, requestId });
  } catch (err) {
    console.error("[admin/storage] delete error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "删除失败" }, requestId }, { status: 500 });
  }
}
