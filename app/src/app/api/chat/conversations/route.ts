import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

/** GET /api/chat/conversations — 列出当前用户的会话 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  const conversations = await prisma.chatConversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({ data: conversations, requestId });
}

/** POST /api/chat/conversations — 创建新会话 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  try {
    const json = await req.json().catch(() => ({}));
    const title = json.title || "新会话";

    const conv = await prisma.chatConversation.create({
      data: {
        userId: user.id,
        title,
      },
    });

    return NextResponse.json({ data: conv, requestId });
  } catch (err) {
    console.error("[chat/conversations] create error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN" }, requestId }, { status: 500 });
  }
}
