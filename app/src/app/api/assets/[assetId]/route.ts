import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { toggleAssetFavorite, hardDeleteAsset } from "@/server/generation/queries";

/** PATCH /api/assets/[assetId] — 切换收藏 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { assetId } = await params;
  try {
    const json = await req.json().catch(() => ({}));
    if (json.action === "favorite" || json.favorite !== undefined) {
      // 单次切换
      const result = await toggleAssetFavorite(assetId, user.id);
      return NextResponse.json({ data: result, requestId });
    }
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "未知操作" }, requestId }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ASSET_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "资产不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "UNKNOWN", message: "操作失败" }, requestId }, { status: 500 });
  }
}

/** DELETE /api/assets/[assetId] — 彻底删除资产（含微调子节点 + 文件） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { assetId } = await params;
  try {
    const result = await hardDeleteAsset(assetId, user.id);
    return NextResponse.json({ data: { ok: true, deletedCount: result.deletedCount }, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ASSET_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "资产不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "UNKNOWN", message: "删除失败" }, requestId }, { status: 500 });
  }
}
