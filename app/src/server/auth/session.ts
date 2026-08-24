/**
 * 基于数据库 Session 表的 cookie 鉴权。
 * - argon2id 哈希密码
 * - cookie 存 session token，HttpOnly + SameSite=Lax
 * - sessionVersion：停用/重置密码后递增，旧 session 失效
 */
import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db/client";
import argon2 from "argon2";
import { env } from "@/lib/env";
import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "cc_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 天

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  sessionVersion: number;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function createSession(
  userId: string,
  sessionVersion: number,
  meta?: { ip?: string; userAgent?: string },
): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
      sessionVersion,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 只在 HTTPS 下带 Secure。原来用 NODE_ENV === "production" 判断，
    // 假设生产一定走 HTTPS（通常有反代做 TLS）。但直接 HTTP 部署时
    // （如 http://192.168.x.x:3000），浏览器会直接丢弃 Secure cookie，
    // 导致登录看似成功但下一个请求就变未登录。改成看实际协议：
    // APP_URL 是 https:// 或反代设了 x-forwarded-proto: https 才带 Secure。
    secure: await isHttpsRequest(),
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/**
 * 判断当前请求是否走 HTTPS。两种情况算 HTTPS：
 * 1. 反向代理设了 `x-forwarded-proto: https`（标准做法）
 * 2. APP_URL 配成 `https://...`（没设反代头时的兜底判断）
 */
async function isHttpsRequest(): Promise<boolean> {
  const headersList = await headers();
  const forwardedProto = headersList.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto === "https";
  return env.APP_URL.startsWith("https://");
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // sessionVersion 不匹配 → 旧 session 失效
  if (session.sessionVersion !== session.user.sessionVersion) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    name: session.user.name,
    role: session.user.role,
    status: session.user.status,
    sessionVersion: session.user.sessionVersion,
  };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new Error("FORBIDDEN");
  return user;
}

export async function invalidateAllSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}

export async function incrementSessionVersion(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  await invalidateAllSessions(userId);
}
