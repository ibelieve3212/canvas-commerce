/**
 * ImageGenerationProvider 接口（见 docs/TECHNICAL_DESIGN.md §5）。
 * 页面和业务服务不得直接调用某一家模型 SDK。
 */
export type ProviderErrorCode =
  | "RATE_LIMITED"
  | "CONTENT_REJECTED"
  | "INVALID_INPUT"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export interface ProviderReferenceImage {
  /** 图片二进制数据 */
  buffer: Buffer;
  mimeType: string;
  /** 参考图角色：商品图/风格图/人物图/品牌图 */
  role: "product" | "style" | "person" | "brand";
  /** 原始上传 ID（用于溯源） */
  uploadId?: string;
}

export interface ProviderImageRequest {
  prompt: string;
  negativePrompt?: string;
  referenceImages: ProviderReferenceImage[];
  aspectRatio: "1:1" | "4:5" | "3:4" | "16:9" | "9:16";
  outputFormat: "png" | "jpeg" | "webp";
  metadata: { batchId: string; jobId: string; outputRole: string };
}

export interface ProviderImageResult {
  imageBuffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  revisedPrompt?: string;
  providerRequestId?: string;
  usage?: Record<string, unknown>;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(
    request: ProviderImageRequest,
    signal?: AbortSignal,
  ): Promise<ProviderImageResult>;
}

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
