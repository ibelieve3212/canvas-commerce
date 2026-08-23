import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "cc_session";
// /api/health 必须公开：Docker healthcheck 与反向代理探活不带 cookie，
// 不放行的话会被重定向到 /login，健康检查永远失败。
const publicPaths = ["/login", "/api/auth/login", "/api/auth/logout", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
