import { env } from "@/lib/env";
import { prisma } from "@/server/db/client";
import type { ImageGenerationProvider } from "./types";
import { mockProvider } from "./mock";
import { CcloadProvider } from "./ccload";

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * 获取用户的 Provider 配置（优先级：用户级 > 管理员默认 > env）。
 * 如果没有任何 newapi 配置，返回 null（降级到 mock）。
 */
export async function getUserProviderConfig(userId: string): Promise<{ mode: "mock" | "newapi"; config?: ProviderConfig }> {
  // 1. 用户级配置
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { providerBaseUrl: true, providerApiKey: true, providerModel: true },
  });

  if (user?.providerBaseUrl && user?.providerApiKey) {
    return {
      mode: "newapi",
      config: {
        baseUrl: user.providerBaseUrl,
        apiKey: user.providerApiKey,
        model: user.providerModel || env.CCLOAD_IMAGE_MODEL || "gpt-image-2",
      },
    };
  }

  // 2. 管理员默认配置（SystemSetting 表）
  const defaultBase = await prisma.systemSetting.findUnique({ where: { key: "provider_base_url" } });
  const defaultKey = await prisma.systemSetting.findUnique({ where: { key: "provider_api_key" } });
  const defaultModel = await prisma.systemSetting.findUnique({ where: { key: "provider_model" } });

  if (defaultBase?.value && defaultKey?.value) {
    return {
      mode: "newapi",
      config: {
        baseUrl: defaultBase.value,
        apiKey: defaultKey.value,
        model: defaultModel?.value || env.CCLOAD_IMAGE_MODEL || "gpt-image-2",
      },
    };
  }

  // 3. env 级配置
  if (env.CCLOAD_NEW_API_BASE_URL && env.CCLOAD_NEW_API_TOKEN) {
    return {
      mode: "newapi",
      config: {
        baseUrl: env.CCLOAD_NEW_API_BASE_URL,
        apiKey: env.CCLOAD_NEW_API_TOKEN,
        model: env.CCLOAD_IMAGE_MODEL || "gpt-image-2",
      },
    };
  }

  // 4. 无配置 → mock
  return { mode: "mock" };
}

/**
 * 根据 userId 动态返回 Provider 实例。
 * Mock provider 是无状态的；newapi provider 每次 new 一个带配置的实例。
 */
export async function getProviderForUser(userId: string): Promise<ImageGenerationProvider> {
  const { mode, config } = await getUserProviderConfig(userId);

  if (mode === "newapi" && config) {
    return new CcloadProvider(config.baseUrl, config.apiKey, config.model);
  }

  return mockProvider;
}

/** 向后兼容：无 userId 时用 env 决定 */
export function getProvider(): ImageGenerationProvider {
  switch (env.GENERATION_PROVIDER) {
    case "newapi":
      if (env.CCLOAD_NEW_API_BASE_URL && env.CCLOAD_NEW_API_TOKEN) {
        return new CcloadProvider(
          env.CCLOAD_NEW_API_BASE_URL,
          env.CCLOAD_NEW_API_TOKEN,
          env.CCLOAD_IMAGE_MODEL,
        );
      }
      return mockProvider;
    case "mock":
    default:
      return mockProvider;
  }
}

export type {
  ImageGenerationProvider,
  ProviderImageRequest,
  ProviderImageResult,
  ProviderErrorCode,
} from "./types";
export { ProviderError } from "./types";
