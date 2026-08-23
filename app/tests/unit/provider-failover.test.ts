import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Provider 故障演练：通过 mock fetch 验证 ccload provider 对各种异常的处理。
 */
// Must mock env before importing provider
vi.mock("@/lib/env", () => ({
  env: {
    CCLOAD_NEW_API_BASE_URL: "http://fake-api.test",
    CCLOAD_NEW_API_TOKEN: "sk-test-token-123456",
    CCLOAD_IMAGE_MODEL: "gpt-image-2",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_PATH: ".data/storage",
    DATABASE_URL: "file:.data/test.db",
    AUTH_SECRET: "test-secret",
    GENERATION_PROVIDER: "newapi",
  },
}));

// We need to dynamically import after env mock
async function getProvider() {
  const mod = await import("@/server/provider/ccload");
  return new mod.CcloadProvider("http://fake-api.test", "sk-test-token-123456", "gpt-image-2");
}

const fakeResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map<string, string>(),
  json: async () => body,
});

describe("Provider 故障演练", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("429 限流 → RATE_LIMITED, retryable=true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse(429, { error: { type: "rate_limit_exceeded", message: "Too many requests" } }),
    );

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
  });

  it("400 内容拒绝 → CONTENT_REJECTED, retryable=false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse(400, { error: { type: "invalid_content", message: "Content policy violation" } }),
    );

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "banned content",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "CONTENT_REJECTED",
      retryable: false,
    });
  });

  it("500 服务不可用 → PROVIDER_UNAVAILABLE, retryable=true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse(500, { error: { message: "Internal server error" } }),
    );

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("408 超时 → PROVIDER_TIMEOUT, retryable=true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse(408, { error: { message: "Request timeout" } }),
    );

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("网络错误（fetch reject）→ PROVIDER_UNAVAILABLE, retryable=true", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("AbortError → PROVIDER_TIMEOUT, retryable=true", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("响应缺少 b64_json → UNKNOWN, retryable=false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeResponse(200, { data: [{ url: "http://example.com/img.png" }] }),
    );

    const provider = await getProvider();
    await expect(
      provider.generate({
        prompt: "test",
        aspectRatio: "1:1",
        outputFormat: "png",
        referenceImages: [],
        metadata: { batchId: "b1", jobId: "j1", outputRole: "main" },
      }),
    ).rejects.toMatchObject({
      code: "UNKNOWN",
      retryable: false,
    });
  });
});
