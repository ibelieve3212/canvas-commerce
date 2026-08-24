/**
 * Chat 渠道配置解析。
 *
 * 优先级（与 provider/index.ts 的生图渠道对称）：
 *   0. 用户勾选"与生图渠道相同" → 直接复用生图渠道解析结果
 *   1. 用户级 chat 配置（chatBaseUrl + chatApiKey 都有）
 *   2. 管理员全局 chat 配置（SystemSetting）
 *   3. 管理员全局 / env 的生图渠道兜底——同一平台通常同时提供 chat 接口
 */
import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import { getUserProviderConfig } from "@/server/provider";

export interface ChatProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** chat 模型的兜底值。用户/管理员都没指定时用它。 */
const DEFAULT_CHAT_MODEL = "gpt-4o";

/**
 * 获取用户的 Chat Provider 配置。
 * 返回 null 表示确实没有任何可用渠道（前端提示去设置页配置）。
 */
export async function getChatProviderConfig(userId: string): Promise<ChatProviderConfig | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      chatBaseUrl: true,
      chatApiKey: true,
      chatModel: true,
      chatUseImageChannel: true,
    },
  });

  // 0. 显式选择与生图渠道相同：复用生图的解析结果（含其自身的三级回退）。
  //    mock 模式没有真实 baseUrl/apiKey，聊天无法工作，故跳过继续往下找。
  if (user?.chatUseImageChannel) {
    const image = await getUserProviderConfig(userId);
    if (image.mode === "newapi" && image.config) {
      return {
        baseUrl: image.config.baseUrl,
        apiKey: image.config.apiKey,
        // 生图模型（如 gpt-image-2）不能拿来聊天，模型仍走 chat 自己的配置
        model: user.chatModel || DEFAULT_CHAT_MODEL,
      };
    }
  }

  // 1. 用户级配置
  if (user?.chatBaseUrl && user?.chatApiKey) {
    return {
      baseUrl: user.chatBaseUrl,
      apiKey: user.chatApiKey,
      model: user.chatModel || DEFAULT_CHAT_MODEL,
    };
  }

  // 2. 管理员全局 chat 配置
  const [defaultBase, defaultKey, defaultModel] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "chat_base_url" } }),
    prisma.systemSetting.findUnique({ where: { key: "chat_api_key" } }),
    prisma.systemSetting.findUnique({ where: { key: "chat_model" } }),
  ]);

  if (defaultBase?.value && defaultKey?.value) {
    return {
      baseUrl: defaultBase.value,
      apiKey: defaultKey.value,
      model: defaultModel?.value || DEFAULT_CHAT_MODEL,
    };
  }

  // 3. 兜底：借用生图渠道（管理员全局或 env）。同一平台大概率也提供 chat。
  const image = await getUserProviderConfig(userId);
  if (image.mode === "newapi" && image.config) {
    return {
      baseUrl: image.config.baseUrl,
      apiKey: image.config.apiKey,
      model: defaultModel?.value || user?.chatModel || DEFAULT_CHAT_MODEL,
    };
  }

  // env 里显式配了 chat 之外的东西也没有 → 确实没渠道
  if (env.CCLOAD_NEW_API_BASE_URL && env.CCLOAD_NEW_API_TOKEN) {
    return {
      baseUrl: env.CCLOAD_NEW_API_BASE_URL,
      apiKey: env.CCLOAD_NEW_API_TOKEN,
      model: DEFAULT_CHAT_MODEL,
    };
  }

  return null;
}
