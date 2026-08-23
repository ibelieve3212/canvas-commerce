import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getCurrentUser, hashPassword, invalidateAllSessions } from "@/server/auth/session";

const PatchBody = z.object({
  action: z.enum(["reset_password", "toggle_status", "update_quota"]),
  password: z.string().min(6).max(200).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  dailyLimit: z.number().int().min(0).optional(),
  totalQuota: z.number().int().min(0).optional(),
  maxConcurrency: z.number().int().min(1).optional(),
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

    // 不可停用自己
    if (userId === currentUser.id && parsed.data.action !== "update_quota") {
      return NextResponse.json({ error: { code: "SELF_FORBIDDEN", message: "不能对自己执行此操作" }, requestId }, { status: 409 });
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
      case "update_quota": {
        const data: Record<string, number> = {};
        if (parsed.data.dailyLimit !== undefined) data.dailyLimit = parsed.data.dailyLimit;
        if (parsed.data.totalQuota !== undefined) data.totalQuota = parsed.data.totalQuota;
        if (parsed.data.maxConcurrency !== undefined) data.maxConcurrency = parsed.data.maxConcurrency;
        if (Object.keys(data).length === 0) {
          return NextResponse.json({ error: { code: "INVALID_INPUT", message: "缺少配额字段" }, requestId }, { status: 400 });
        }
        // upsert quota
        const existing = await prisma.userQuota.findUnique({ where: { userId } });
        if (existing) {
          await prisma.userQuota.update({ where: { userId }, data });
        } else {
          await prisma.userQuota.create({
            data: {
              userId,
              dailyLimit: data.dailyLimit ?? 20,
              totalQuota: data.totalQuota ?? 100,
              maxConcurrency: data.maxConcurrency ?? 2,
              dailyDate: new Date().toISOString().slice(0, 10),
            },
          });
        }
        // 审计日志（P1：管理员调整额度有日志记录）
        console.info(`[AUDIT] admin=${currentUser.id} updated_quota user=${userId}`, {
          action: "update_quota",
          targetUserId: userId,
          changes: data,
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
