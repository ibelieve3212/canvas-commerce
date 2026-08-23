/**
 * Chat 渠道配置解析（三级优先级：用户级 > 管理员默认 > env）。
 * 照抄 provider/index.ts 的模式。
 */
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";

export interface ChatProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 获取用户的 Chat Provider 配置。
 * 返回 null 表示未配置（前端应提示用户去设置页配置）。
 */
export async function getChatProviderConfig(userId: string): Promise<ChatProviderConfig | null> {
  // 1. 用户级配置
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { chatBaseUrl: true, chatApiKey: true, chatModel: true },
  });

  if (user?.chatBaseUrl && user?.chatApiKey) {
    return {
      baseUrl: user.chatBaseUrl,
      apiKey: user.chatApiKey,
      model: user.chatModel || "gpt-4o",
    };
  }

  // 2. 管理员默认配置
  const defaultBase = await prisma.systemSetting.findUnique({ where: { key: "chat_base_url" } });
  const defaultKey = await prisma.systemSetting.findUnique({ where: { key: "chat_api_key" } });
  const defaultModel = await prisma.systemSetting.findUnique({ where: { key: "chat_model" } });

  if (defaultBase?.value && defaultKey?.value) {
    return {
      baseUrl: defaultBase.value,
      apiKey: defaultKey.value,
      model: defaultModel?.value || "gpt-4o",
    };
  }

  // 3. env 级配置（复用图像渠道的 base URL + token，因为同一平台大概率同时提供 chat）
  if (env.CCLOAD_NEW_API_BASE_URL && env.CCLOAD_NEW_API_TOKEN) {
    return {
      baseUrl: env.CCLOAD_NEW_API_BASE_URL,
      apiKey: env.CCLOAD_NEW_API_TOKEN,
      model: "gpt-4o",
    };
  }

  return null;
}
