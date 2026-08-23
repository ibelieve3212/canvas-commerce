/**
 * 测试用 API：注入 Mock 故障。
 * 仅在非 production 环境可用，用于 E2E 测试故障注入场景。
 */
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { injectMockFailure, clearMockFailures } from "@/server/provider/mock";

export async function POST(req: NextRequest) {
  if (env.NODE_ENV === "production") {
    return NextResponse.json({ error: "DISABLED" }, { status: 404 });
  }
  const { jobId } = await req.json();
  injectMockFailure(jobId);
  return NextResponse.json({ data: { injected: true } });
}

export async function DELETE() {
  if (env.NODE_ENV === "production") {
    return NextResponse.json({ error: "DISABLED" }, { status: 404 });
  }
  clearMockFailures();
  return NextResponse.json({ data: { cleared: true } });
}
