import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { tweakAsset } from "@/server/generation/tweak";

/** POST /api/assets/[assetId]/tweak — 微调图片 */
export async function POST(
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
    const description = (json.description as string) || "";
    if (!description.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "请输入微调描述" }, requestId },
        { status: 400 },
      );
    }

    const result = await tweakAsset(assetId, user.id, description);
    return NextResponse.json({ data: result, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ASSET_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "资产不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    if (msg === "TWEAK_LIMIT_EXCEEDED") {
      return NextResponse.json({ error: { code: "TWEAK_LIMIT", message: "已达到微调上限（3 轮），建议重新生成" }, requestId }, { status: 429 });
    }
    if (msg === "REFERENCE_IMAGE_MISSING") {
      // 原始商品图已被自动清理（超保留期或超数量上限）。
      // 宁可报错也不静默降级：降级会让效果变差，而用户无法得知原因。
      return NextResponse.json(
        {
          error: {
            code: "REFERENCE_IMAGE_MISSING",
            message: "原始商品图已过保留期被清理，无法继续微调。请重新上传商品图生成。",
          },
          requestId,
        },
        { status: 409 },
      );
    }
    console.error("[tweak] 未处理错误:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: msg || "微调失败" }, requestId }, { status: 500 });
  }
}
