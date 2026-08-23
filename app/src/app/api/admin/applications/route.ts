import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

/** GET /api/admin/applications — 管理员应用列表 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });
  }

  const apps = await prisma.application.findMany({
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json({ data: apps, requestId });
}

/** PATCH /api/admin/applications — 批量更新应用排序/上下架 */
export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });
  }

  try {
    const json = await req.json();
    const parsed = z.array(z.object({
      id: z.string(),
      isPublished: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    })).safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "参数错误" }, requestId }, { status: 400 });
    }

    for (const item of parsed.data) {
      await prisma.application.update({
        where: { id: item.id },
        data: {
          ...(item.isPublished !== undefined && { isPublished: item.isPublished }),
          ...(item.sortOrder !== undefined && { sortOrder: item.sortOrder }),
        },
      });
    }

    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    console.error("[admin/applications] error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "更新失败" }, requestId }, { status: 500 });
  }
}
