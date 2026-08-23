import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { exportBatchZip, exportBatchLongImage } from "@/server/export/service";

const Body = z.object({
  type: z.enum(["ZIP", "LONG_IMAGE"]),
});

/** POST /api/exports/[batchId] — 导出批次 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });

  const { batchId } = await params;
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "type 必须为 ZIP 或 LONG_IMAGE" }, requestId }, { status: 400 });
    }

    let result;
    if (parsed.data.type === "ZIP") {
      result = await exportBatchZip(batchId, user.id);
    } else {
      result = await exportBatchLongImage(batchId, user.id);
    }

    return NextResponse.json({
      data: {
        exportId: result.exportId,
        objectKey: result.objectKey,
        downloadUrl: `/api/storage/${encodeURIComponent(result.objectKey)}`,
      },
      requestId,
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BATCH_NOT_FOUND") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "批次不存在" }, requestId }, { status: 404 });
    }
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "无权限" }, requestId }, { status: 403 });
    }
    if (msg === "NO_ASSETS") {
      return NextResponse.json({ error: { code: "NO_ASSETS", message: "批次中没有可导出的成功图片" }, requestId }, { status: 400 });
    }
    console.error("[export] error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "导出失败" }, requestId }, { status: 500 });
  }
}
