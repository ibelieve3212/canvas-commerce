import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { buildMessages, saveUserMessage, saveAssistantMessage, streamChat } from "@/server/chat/service";

/**
 * POST /api/chat — 发送消息，SSE 流式返回。
 *
 * Body: { conversationId: string, content: string, image?: base64 }
 * Response: SSE stream
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  try {
    const json = await req.json();
    const { conversationId, content, image, imageMimeType } = json as {
      conversationId: string;
      content: string;
      image?: string;
      imageMimeType?: string;
    };

    if (!conversationId || !content) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "缺少 conversationId 或 content" } }, { status: 400 });
    }

    // 验证会话归属
    const conv = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conv) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "会话不存在" } }, { status: 404 });
    }
    if (conv.userId !== user.id) {
      return NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }

    // 保存用户消息
    let imageBuffer: Buffer | undefined;
    let imgMimeType: string | undefined;
    if (image) {
      imageBuffer = Buffer.from(image, "base64");
      imgMimeType = imageMimeType || "image/png";
    }
    await saveUserMessage(conversationId, content, imageBuffer, imgMimeType);

    // 拼消息
    const messages = await buildMessages(conversationId);

    // 调 provider，获取 SSE stream
    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await streamChat(user.id, messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "CHAT_PROVIDER_NOT_CONFIGURED") {
        return NextResponse.json({ error: { code: "NOT_CONFIGURED", message: "请先在设置页配置 Chat 渠道" } }, { status: 400 });
      }
      throw err;
    }

    // 包一层：在流结束时收集完整回复并保存
    let fullContent = "";

    const wrappedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 透传原始 SSE 数据
            controller.enqueue(value);

            // 解析 content delta
            const text = decoder.decode(value, { stream: true });
            const lines = text.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ") && line !== "data: [DONE]") {
                try {
                  const data = JSON.parse(line.slice(6));
                  const delta = data.choices?.[0]?.delta?.content;
                  if (delta) fullContent += delta;
                } catch {
                  // 非 JSON 行，跳过
                }
              }
            }
          }
        } catch (err) {
          console.error("[chat] stream error:", err);
        } finally {
          // 保存 assistant 回复
          if (fullContent) {
            try {
              await saveAssistantMessage(conversationId, fullContent);
            } catch (e) {
              console.error("[chat] save assistant message failed:", e);
            }
          }
          controller.close();
        }
      },
    });

    return new Response(wrappedStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN", message: "聊天请求失败" } }, { status: 500 });
  }
}
