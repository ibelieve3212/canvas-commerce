import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { createBatch } from "@/server/generation/service";
import type { FormValues } from "@/contracts/generation";

const AspectRatio = z.enum(["1:1", "4:5", "3:4", "16:9", "9:16"]);

const Body = z.object({
  applicationId: z.string().min(1),
  formValues: z.record(z.string(), z.unknown()) as z.ZodType<FormValues>,
  referenceImages: z.array(z.object({
    uploadId: z.string().min(1),
    role: z.enum(["product", "style", "person", "brand"]),
  })).default([]),
  aspectRatio: AspectRatio,
  requestedCount: z.number().int().min(1).max(10),
  idempotencyKey: z.string().optional(),
  parentBatchId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: parsed.error.message }, requestId },
        { status: 400 },
      );
    }

    const result = await createBatch({
      userId: user.id,
      ...parsed.data,
    });

    return NextResponse.json({ data: result, requestId }, { status: result.isExisting ? 200 : 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("VALIDATION_FAILED")) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", message: "表单校验失败" }, requestId },
        { status: 400 },
      );
    }
    if (msg === "QUOTA_EXCEEDED") {
      return NextResponse.json(
        { error: { code: "QUOTA_EXCEEDED", message: "配额不足" }, requestId },
        { status: 429 },
      );
    }
    if (msg === "APPLICATION_NOT_FOUND") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "应用不存在" }, requestId },
        { status: 404 },
      );
    }
    console.error("[batches] error:", err);
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: "创建失败" }, requestId },
      { status: 500 },
    );
  }
}

/** 获取当前用户批次列表（支持筛选/分页） */
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
  const status = url.searchParams.get("status") ?? undefined;
  const applicationId = url.searchParams.get("applicationId") ?? undefined;
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "12", 10);

  const { listBatches } = await import("@/server/generation/queries");
  const result = await listBatches(user.id, { status, applicationId, page, pageSize });

  return NextResponse.json({ data: result, requestId });
}
