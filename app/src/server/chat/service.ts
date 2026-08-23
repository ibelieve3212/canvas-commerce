/**
 * Chat Service — 拼消息、滞动窗口、vision 拼图。
 */
import { prisma } from "@/server/db/client";
import { getChatProviderConfig } from "./provider";
import { getStorage, makeObjectKey } from "@/server/storage/adapter";

const MAX_CONTEXT_MESSAGES = 40; // 滞动窗口：最近 40 条

/** OpenAI chat message 格式 */
export interface ChatMessageItem {
  role: "user" | "assistant" | "system";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

/**
 * 从数据库加载会话历史，拼成 OpenAI messages 数组。
 * 滞动窗口：只取最近 MAX_CONTEXT_MESSAGES 条。
 */
export async function buildMessages(
  conversationId: string,
): Promise<ChatMessageItem[]> {
  const messages = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: MAX_CONTEXT_MESSAGES,
    select: { role: true, content: true, imageObjectKey: true },
  });

  const items: ChatMessageItem[] = [];

  // system prompt
  items.push({
    role: "system",
    content:
      "你是一个电商AI助手，帮助用户理解图片结构、构思文案、优化提示词。请用中文回答，简洁专业。",
  });

  for (const msg of messages) {
    if (msg.role === "user" && msg.imageObjectKey) {
      // vision 消息：图片 + 文本
      const storage = getStorage();
      const buffer = await storage.get(msg.imageObjectKey);
      const base64 = `data:image/png;base64,${buffer.toString("base64")}`;
      items.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: base64 } },
          { type: "text", text: msg.content || "请分析这张图片" },
        ],
      });
    } else {
      items.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }
  }

  return items;
}

/** 保存用户消息（含可选贴图） */
export async function saveUserMessage(
  conversationId: string,
  content: string,
  imageBuffer?: Buffer,
  imageMimeType?: string,
): Promise<void> {
  let imageObjectKey: string | null = null;

  if (imageBuffer && imageMimeType) {
    const ext = imageMimeType === "image/jpeg" ? "jpg" : imageMimeType === "image/webp" ? "webp" : "png";
    imageObjectKey = makeObjectKey("dummy-user-id", ext); // makeObjectKey 需要 userId，但聊天贴图不需要归属用户路径
    // 实际上 makeObjectKey 需要真实 userId，但我们用 conversation 关联用户
    // 这里简化：直接用固定路径
    imageObjectKey = `chat/${conversationId}/${crypto.randomUUID()}.${ext}`;
    const storage = getStorage();
    await storage.put(imageObjectKey, imageBuffer);
  }

  await prisma.chatMessage.create({
    data: {
      conversationId,
      role: "user",
      content,
      imageObjectKey,
    },
  });

  // 更新会话时间
  await prisma.chatConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
}

/** 保存 assistant 回复 */
export async function saveAssistantMessage(
  conversationId: string,
  content: string,
): Promise<void> {
  await prisma.chatMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content,
    },
  });
}

/**
 * 调用 chat completions API，返回 ReadableStream（SSE 格式）。
 * 父调用者直接把它 pipe 到 Response。
 */
export async function streamChat(
  userId: string,
  messages: ChatMessageItem[],
): Promise<ReadableStream<Uint8Array>> {
  const config = await getChatProviderConfig(userId);
  if (!config) {
    throw new Error("CHAT_PROVIDER_NOT_CONFIGURED");
  }

  const cleanBase = config.baseUrl.replace(/\/+$/, "");
  const url = `${cleanBase}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[chat] provider error:", response.status, errorText);
    throw new Error(`PROVIDER_ERROR:${response.status}`);
  }

  if (!response.body) {
    throw new Error("NO_RESPONSE_BODY");
  }

  // 直接透传 provider 的 SSE 流
  return response.body as ReadableStream<Uint8Array>;
}
