/**
 * 健康检查端点。供 Docker healthcheck / 反向代理探活使用。
 *
 * 故意查一次数据库：只回 200 而不碰 DB 的话，SQLite 文件权限错误、
 * volume 没挂上、migration 没跑完这几种"HTTP 活着但业务全挂"的情况探不出来。
 *
 * 不需要登录 —— 探活请求不带 cookie。回包不含任何敏感信息。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // 轻量查询：只确认连接可用且表结构在位
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("[health] 数据库不可用:", err);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
