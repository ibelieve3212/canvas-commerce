import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { deleteConversation } from "@/server/deletion/service";

/** GET /api/chat/conversations/[id] — 获取会话消息列表 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  const { id } = await params;

  // 验证会话归属
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conv) {
    return NextResponse.json({ error: { code: "NOT_FOUND" }, requestId }, { status: 404 });
  }
  if (conv.userId !== user.id) {
    return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      imageObjectKey: true,
      createdAt: true,
    },
  });

  // 图片 URL 转换
  const result = messages.map((m) => ({
    ...m,
    imageUrl: m.imageObjectKey
      ? `/api/storage/${encodeURIComponent(m.imageObjectKey)}`
      : null,
    imageObjectKey: undefined,
  }));

  return NextResponse.json({ data: result, requestId });
}

/** DELETE /api/chat/conversations/[id] — 删除会话 + 关联消息 + 贴图文件 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  const { id } = await params;

  // 验证会话归属
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!conv) {
    return NextResponse.json({ error: { code: "NOT_FOUND" }, requestId }, { status: 404 });
  }
  if (conv.userId !== user.id) {
    return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });
  }

  // 删会话 + 消息 + 贴图文件，走统一删除层
  await deleteConversation(id);

  return NextResponse.json({ data: { ok: true }, requestId });
}
