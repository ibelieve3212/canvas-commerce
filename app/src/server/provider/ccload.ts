/**
 * CCLOAD New API Provider — 通过 OpenAI-compatible Images API 生成图片。
 *
 * 基于 docs/PROVIDER_SETUP.md 的实测结果：
 * - POST /v1/images/generations，同步返回 b64_json + url + revised_prompt
 * - 优先使用 b64_json，解码后验证 PNG 签名
 * - 一 Job 一图（n=1）
 * - 错误分类：RATE_LIMITED / CONTENT_REJECTED / PROVIDER_UNAVAILABLE / UNKNOWN
 */
import {
  type ImageGenerationProvider,
  type ProviderImageRequest,
  type ProviderImageResult,
  type ProviderErrorCode,
  ProviderError,
} from "./types";
import { maskApiKey, maskBaseUrl } from "@/server/log/sanitize";
import { MAX_PROVIDER_REFERENCE_IMAGES } from "@/contracts/generation";

// 宽高比 → size 映射（gpt-image-2 支持 1024x1024 / 1024x1536 / 1536x1024）
function aspectRatioToSize(ratio: string): string {
  switch (ratio) {
    case "1:1": return "1024x1024";
    case "4:5":
    case "3:4": return "1024x1536";
    case "16:9":
    case "9:16": return "1536x1024";
    default: return "1024x1024";
  }
}

export class CcloadProvider implements ImageGenerationProvider {
  readonly name = "ccload-newapi";

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  async generate(
    request: ProviderImageRequest,
    signal?: AbortSignal,
  ): Promise<ProviderImageResult> {
    const baseUrl = this.baseUrl;
    const token = this.apiKey;

    if (!baseUrl || !token) {
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Provider baseURL 或 API Token 未配置",
        false,
      );
    }

    const cleanBase = baseUrl.replace(/\/+$/, "");
    const hasReferenceImages = request.referenceImages.length > 0;

    let response: Response;

    if (hasReferenceImages) {
      // 有参考图 → 用 /v1/images/edits (multipart)
      const url = `${cleanBase}/v1/images/edits`;
      const formData = new FormData();
      formData.append("model", this.model);
      formData.append("prompt", request.prompt);
      formData.append("size", aspectRatioToSize(request.aspectRatio));
      formData.append("n", "1");

      // 添加参考图。OpenAI images/edits 的多图写法是重复 append 同一个
      // 字段名 "image"（数组语义由重复决定），不是 "image[]"——
      // 后者多数网关不认，会被整个忽略，表现为"参考图完全没生效"。
      const productImages = request.referenceImages.filter(r => r.role === "product");
      const otherImages = request.referenceImages.filter(r => r.role !== "product");

      // 发图顺序与 prompt 中 {{ref_images}} 的编号一致：
      // product 第 1 张，其余按 style/person/brand 顺序在后
      // （refRoleOrder 与 contracts/generation.ts 里的编号顺序保持一致）
      const otherOrder: Record<string, number> = { style: 1, person: 2, brand: 3 };
      const sortedOthers = [...otherImages].sort(
        (a, b) => (otherOrder[a.role] ?? 9) - (otherOrder[b.role] ?? 9),
      );
      const ordered = productImages.length > 0
        ? [productImages[0], ...sortedOthers]
        : [...request.referenceImages];

      const extOf = (mime: string) =>
        mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      const labelOf = (role: string) =>
        role === "product" ? "product"
          : role === "style" ? "style"
            : role === "person" ? "person"
              : role === "brand" ? "brand"
                : "ref";

      // 上限：商品主图 + 最多 3 张附加参考（与 prompt 里的“第N张”编号共用同一常量）
      for (let i = 0; i < ordered.length && i < MAX_PROVIDER_REFERENCE_IMAGES; i++) {
        const img = ordered[i];
        formData.append(
          "image",
          new Blob([new Uint8Array(img.buffer)], { type: img.mimeType }),
          `${labelOf(img.role)}${i + 1}.${extOf(img.mimeType)}`,
        );
      }

      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
          signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new ProviderError("PROVIDER_TIMEOUT", "请求被取消", true);
        }
        throw new ProviderError(
          "PROVIDER_UNAVAILABLE",
          `网络错误: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    } else {
      // 无参考图 → 用 /v1/images/generations (JSON)
      const url = `${cleanBase}/v1/images/generations`;
      const body = {
        model: this.model,
        prompt: request.prompt,
        size: aspectRatioToSize(request.aspectRatio),
        quality: "low",
        n: 1,
        output_format: request.outputFormat === "png" ? "png" : request.outputFormat === "webp" ? "webp" : "jpeg",
      };

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new ProviderError("PROVIDER_TIMEOUT", "请求被取消", true);
        }
        throw new ProviderError(
          "PROVIDER_UNAVAILABLE",
          `网络错误: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    }

    const providerRequestId =
      response.headers.get("x-oneapi-request-id") ??
      response.headers.get("ah-request-id") ??
      response.headers.get("x-request-id") ??
      undefined;

    // 解析响应
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(`[ccload] error ${response.status}`, {
        baseUrl: maskBaseUrl(baseUrl),
        token: maskApiKey(token),
        status: response.status,
      });
      throw classifyError(response.status, json);
    }

    // 实测（2026-10）：gpt-image-2 渠道存在两种响应模式，且会随上游状态来回切换——
    // a) data[0].b64_json（标准 OpenAI 格式）
    // b) 仅 data[0].url：上游把生成图转存至自有图床后只回传下载链接。
    // 两种模式都按成功处理：优先 b64_json；缺失时下载 url。
    // 下载结果仍走下方签名验证，不信任 Content-Type。
    let imageBuffer: Buffer;

    if (json?.data?.[0]?.b64_json) {
      const raw = json.data[0].b64_json as string;
      try {
        imageBuffer = Buffer.from(raw, "base64");
      } catch {
        throw new ProviderError("UNKNOWN", "b64_json 解码失败", false);
      }
    } else {
      const imageUrl = json?.data?.[0]?.url;
      if (typeof imageUrl !== "string" || imageUrl.length === 0) {
        // json 为 null 说明 200 但响应不是合法 JSON（网关伪成功/错误页），值得重试；
        // JSON 合法但两个字段都缺才是真正的未知格式，不重试。
        throw new ProviderError(
          "UNKNOWN",
          json === null
            ? "上游响应不是合法 JSON（可能为网关错误页）"
            : "响应中缺少 b64_json 与 url 字段",
          json === null,
        );
      }
      try {
        const imageResp = await fetch(imageUrl, { signal });
        if (!imageResp.ok) {
          throw new ProviderError(
            "PROVIDER_UNAVAILABLE",
            `图片 URL 下载失败: HTTP ${imageResp.status}`,
            true,
          );
        }
        imageBuffer = Buffer.from(await imageResp.arrayBuffer());
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new ProviderError("PROVIDER_TIMEOUT", "请求被取消", true);
        }
        throw new ProviderError(
          "PROVIDER_UNAVAILABLE",
          `图片 URL 下载失败: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    }

    // 验证 PNG 签名
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
    const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF

    let mimeType = "image/png";
    let width = 1024;
    let height = 1024;

    if (imageBuffer.length >= 8 && PNG_MAGIC.equals(imageBuffer.subarray(0, 8))) {
      mimeType = "image/png";
      width = imageBuffer.readUInt32BE(16);
      height = imageBuffer.readUInt32BE(20);
    } else if (imageBuffer.length >= 3 && JPEG_MAGIC.equals(imageBuffer.subarray(0, 3))) {
      mimeType = "image/jpeg";
      // JPEG 尺寸解析较复杂，用默认值
      width = 1024;
      height = 1024;
    } else if (imageBuffer.length >= 4 && WEBP_MAGIC.equals(imageBuffer.subarray(0, 4))) {
      mimeType = "image/webp";
      width = imageBuffer.readUInt32LE(12) & 0x3fff || 1024;
      height = imageBuffer.readUInt32LE(16) & 0x3fff || 1024;
    } else {
      throw new ProviderError("UNKNOWN", "图片文件签名验证失败", false);
    }

    return {
      imageBuffer,
      mimeType,
      width,
      height,
      revisedPrompt: json.data[0].revised_prompt,
      providerRequestId,
      usage: json.usage as Record<string, unknown> | undefined,
    };
  }
}

function classifyError(status: number, json: unknown): ProviderError {
  const errorObj = (json as { error?: { message?: string; type?: string; code?: string } })?.error;
  const message = errorObj?.message ?? `HTTP ${status}`;
  const type = errorObj?.type ?? "";
  const code = errorObj?.code ?? "";

  // 429 限流
  if (status === 429 || type.includes("rate") || type.includes("limit") || message.includes("请求数限制")) {
    return new ProviderError("RATE_LIMITED", message, true);
  }

  // 配额不足
  if (type.includes("quota") || code.includes("quota") || message.includes("quota")) {
    return new ProviderError("RATE_LIMITED", message, false);
  }

  // 内容拒绝
  if (status === 400 && (message.includes("content") || type.includes("content"))) {
    return new ProviderError("CONTENT_REJECTED", message, false);
  }

  // 5xx 服务不可用
  if (status >= 500) {
    return new ProviderError("PROVIDER_UNAVAILABLE", message, true);
  }

  // 超时
  if (status === 408 || type.includes("timeout")) {
    return new ProviderError("PROVIDER_TIMEOUT", message, true);
  }

  const errorCode: ProviderErrorCode = "UNKNOWN";
  return new ProviderError(errorCode, message, false);
}

// ccloadProvider is now created dynamically with config
