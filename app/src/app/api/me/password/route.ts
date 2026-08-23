import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, hashPassword, invalidateAllSessions } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

const Body = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

/** POST /api/me/password — 修改密码，修改后原会话失效 */
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
        { error: { code: "INVALID_INPUT", message: "新密码至少 8 位" }, requestId },
        { status: 400 },
      );
    }

    // 验证当前密码
    const valid = await verifyPassword(user.id, parsed.data.currentPassword);
    if (!valid) {
      return NextResponse.json(
        { error: { code: "INVALID_PASSWORD", message: "当前密码不正确" }, requestId },
        { status: 403 },
      );
    }

    // 更新密码
    const hashed = await hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashed,
        sessionVersion: { increment: 1 },
      },
    });

    // 失效所有旧会话（包括当前）
    await invalidateAllSessions(user.id);

    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    console.error("[me/password] error:", err);
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: "修改失败" }, requestId },
      { status: 500 },
    );
  }
}

async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const argon2 = await import("argon2");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  try {
    return await argon2.verify(user.passwordHash, password);
  } catch {
    return false;
  }
}
