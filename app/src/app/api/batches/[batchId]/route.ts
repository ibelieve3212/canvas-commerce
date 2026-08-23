import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getBatchWithJobs, cancelBatch } from "@/server/generation/service";
import { hardDeleteBatch } from "@/server/generation/queries";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { batchId } = await params;
  const batch = await getBatchWithJobs(batchId, user.id);
  if (!batch) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "批次不存在" }, requestId },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: batch, requestId });
}

/** DELETE /api/batches/[batchId] — 彻底删除批次（整棵树 + 文件） */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { batchId } = await params;
  try {
    await hardDeleteBatch(batchId, user.id);
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BATCH_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "批次不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "UNKNOWN", message: "删除失败" }, requestId }, { status: 500 });
  }
}

/** PATCH /api/batches/[batchId] — 取消批次 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { batchId } = await params;
  try {
    await cancelBatch(batchId, user.id);
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BATCH_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "批次不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "UNKNOWN", message: "取消失败" }, requestId }, { status: 500 });
  }
}
