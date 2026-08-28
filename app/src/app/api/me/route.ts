import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";

/** GET /api/me — 当前用户信息 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  return NextResponse.json({
    data: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
    },
    requestId,
  });
}
