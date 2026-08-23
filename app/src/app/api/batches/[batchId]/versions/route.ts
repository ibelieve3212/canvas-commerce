import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getVersionChain } from "@/server/generation/queries";

/** GET /api/batches/[batchId]/versions — 获取版本链 */
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
  try {
    const chain = await getVersionChain(batchId, user.id);
    return NextResponse.json({ data: chain, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BATCH_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "批次不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    return NextResponse.json({ error: { code: "UNKNOWN", message: "获取失败" }, requestId }, { status: 500 });
  }
}
