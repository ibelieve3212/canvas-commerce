import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { retryJob } from "@/server/generation/service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string; jobId: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  const { jobId } = await params;
  try {
    await retryJob(jobId, user.id);
    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "FORBIDDEN") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "无权限" }, requestId },
        { status: 403 },
      );
    }
    if (msg === "JOB_NOT_FOUND") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "任务不存在" }, requestId },
        { status: 404 },
      );
    }
    if (msg === "JOB_NOT_FAILED") {
      return NextResponse.json(
        { error: { code: "INVALID_STATE", message: "任务未失败，无法重试" }, requestId },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: "重试失败" }, requestId },
      { status: 500 },
    );
  }
}
