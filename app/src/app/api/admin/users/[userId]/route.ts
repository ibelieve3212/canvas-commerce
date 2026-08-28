import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getCurrentUser, hashPassword, invalidateAllSessions } from "@/server/auth/session";

const PatchBody = z.object({
  action: z.enum(["reset_password", "toggle_status"]),
  password: z.string().min(6).max(200).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const requestId = crypto.randomUUID();
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  if (currentUser.role !== "ADMIN") return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });

  const { userId } = await params;
  try {
    const json = await req.json();
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: parsed.error.message }, requestId }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return NextResponse.json({ error: { code: "NOT_FOUND", message: "用户不存在" }, requestId }, { status: 404 });

    // 不可停用自己，也不能给自己重置密码（改自己的密码走 /settings）
    if (userId === currentUser.id) {
      return NextResponse.json({ error: { code: "SELF_FORBIDDEN", message: "不能对自己执行此操作，改自己的密码请去设置页" }, requestId }, { status: 409 });
    }

    switch (parsed.data.action) {
      case "reset_password": {
        if (!parsed.data.password) {
          return NextResponse.json({ error: { code: "INVALID_INPUT", message: "缺少密码" }, requestId }, { status: 400 });
        }
        const hash = await hashPassword(parsed.data.password);
        await prisma.user.update({
          where: { id: userId },
          data: { passwordHash: hash, sessionVersion: { increment: 1 } },
        });
        await invalidateAllSessions(userId);
        console.info(`[AUDIT] admin=${currentUser.id} reset_password user=${userId}`, {
          action: "reset_password",
          targetUserId: userId,
          at: new Date().toISOString(),
        });
        break;
      }
      case "toggle_status": {
        const newStatus = parsed.data.status ?? (target.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
        await prisma.user.update({ where: { id: userId }, data: { status: newStatus } });
        if (newStatus === "SUSPENDED") {
          await invalidateAllSessions(userId);
        }
        console.info(`[AUDIT] admin=${currentUser.id} toggle_status user=${userId} status=${newStatus}`, {
          action: "toggle_status",
          targetUserId: userId,
          newStatus,
          at: new Date().toISOString(),
        });
        break;
      }
    }

    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    console.error("[admin/users] patch error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "操作失败" }, requestId }, { status: 500 });
  }
}
