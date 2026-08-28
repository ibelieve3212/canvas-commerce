import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getCurrentUser, hashPassword } from "@/server/auth/session";
import { UsernameSchema } from "@/contracts/user";

const Body = z.object({
  username: UsernameSchema,
  name: z.string().min(1).max(50),
  password: z.string().min(6).max(200),
  role: z.enum(["USER", "ADMIN"]).default("USER"),
});

export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      status: true,
      sessionVersion: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ data: users, requestId });
}

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });

  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: parsed.error.message }, requestId }, { status: 400 });
    }

    const { username, name, password, role } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: { code: "DUPLICATE_USERNAME", message: "用户名已被使用" }, requestId }, { status: 409 });
    }

    const hash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        username,
        name,
        passwordHash: hash,
        role,
        status: "ACTIVE",
      },
      select: { id: true, username: true, name: true, role: true, status: true, createdAt: true },
    });

    return NextResponse.json({ data: newUser, requestId }, { status: 201 });
  } catch (err) {
    console.error("[admin/users] create error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "创建失败" }, requestId }, { status: 500 });
  }
}
