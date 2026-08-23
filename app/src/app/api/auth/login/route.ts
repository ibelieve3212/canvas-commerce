import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
} from "@/server/auth/session";
import { checkRateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { UsernameSchema } from "@/contracts/user";

const Body = z.object({
  username: UsernameSchema,
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "用户名或密码格式错误" }, requestId },
        { status: 400 },
      );
    }

    const { username, password } = parsed.data;

    // 限流检查
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rateKey = `login:${ip}:${username}`;
    const rate = checkRateLimit(rateKey);
    if (!rate.allowed) {
      const secs = Math.ceil(rate.resetInMs / 1000);
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: `登录尝试过多，请 ${secs} 秒后再试` }, requestId },
        { status: 429 },
      );
    }

    const user = await prisma.user.findUnique({ where: { username } });

    // 不泄露用户名是否存在
    if (!user || user.status !== "ACTIVE") {
      await verifyPassword("$argon2id$v=19$m=65536,t=3,p=4$dummy", password).catch(() => {});
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }, requestId },
        { status: 401 },
      );
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }, requestId },
        { status: 401 },
      );
    }

    // 登录成功，清除限流计数
    resetRateLimit(rateKey);

    const token = await createSession(user.id, user.sessionVersion, {
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    await setSessionCookie(token);

    return NextResponse.json({
      data: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      requestId,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: "登录失败" }, requestId },
      { status: 500 },
    );
  }
}
