/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CcloadProvider } from "@/server/provider/ccload";

// Mock env
vi.mock("@/lib/env", () => ({
  env: {
    CCLOAD_NEW_API_BASE_URL: "http://test.example.com",
    CCLOAD_NEW_API_TOKEN: "test-token",
    CCLOAD_IMAGE_MODEL: "gpt-image-2",
    CCLOAD_IMAGE_ENDPOINT_MODE: "images",
    GENERATION_PROVIDER: "newapi",
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makePngBuffer(): Buffer {
  const zlib = require("node:zlib");
  const W = 64, H = 64;
  const rowSize = W * 4 + 1;
  const raw = Buffer.alloc(rowSize * H);
  for (let y = 0; y < H; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * rowSize + 1 + x * 4;
      raw[o] = 255; raw[o+1] = 0; raw[o+2] = 0; raw[o+3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  function chunk(type: string, data: Buffer): Buffer {
    const tb = Buffer.from(type,"ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length,0);
    const crc = zlib.crc32(Buffer.concat([tb,data]));
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc>>>0,0);
    return Buffer.concat([len,tb,data,cb]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",compressed), chunk("IEND",Buffer.alloc(0))]);
}

describe("CcloadProvider", () => {
  let provider: CcloadProvider;

  beforeEach(() => {
    provider = new CcloadProvider("http://fake-api.test", "sk-test-token-123456", "gpt-image-2");
    mockFetch.mockReset();
  });

  it("名称为 ccload-newapi", () => {
    expect(provider.name).toBe("ccload-newapi");
  });

  it("成功生成图片并验证 PNG 签名", async () => {
    const png = makePngBuffer();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "x-oneapi-request-id": "req-123" }),
      json: async () => ({
        data: [{ b64_json: png.toString("base64"), url: "https://example.com/img.png", revised_prompt: "a red square" }],
        usage: { total_tokens: 100 },
      }),
    });

    const result = await provider.generate({
      prompt: "test",
      aspectRatio: "1:1",
      outputFormat: "png",
      referenceImages: [],
      metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    });

    expect(result.imageBuffer.length).toBe(png.length);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
    expect(result.revisedPrompt).toBe("a red square");
    expect(result.providerRequestId).toBe("req-123");
    expect(result.usage?.total_tokens).toBe(100);
  });

  it("429 限流错误标记为 retryable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers(),
      json: async () => ({ error: { message: "请求数限制", type: "new_api_error" } }),
    });

    await expect(provider.generate({
      prompt: "test", aspectRatio: "1:1", outputFormat: "png",
      referenceImages: [], metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("500 服务端错误标记为 retryable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 502, headers: new Headers(),
      json: async () => ({ error: { message: "Bad Gateway" } }),
    });

    await expect(provider.generate({
      prompt: "test", aspectRatio: "1:1", outputFormat: "png",
      referenceImages: [], metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("缺少 b64_json 时抛出 UNKNOWN", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ data: [{ url: "https://example.com/img.png" }] }),
    });

    await expect(provider.generate({
      prompt: "test", aspectRatio: "1:1", outputFormat: "png",
      referenceImages: [], metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    })).rejects.toMatchObject({ code: "UNKNOWN", retryable: false });
  });

  it("网络错误标记为 PROVIDER_UNAVAILABLE + retryable", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(provider.generate({
      prompt: "test", aspectRatio: "1:1", outputFormat: "png",
      referenceImages: [], metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    })).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
  });

  it("宽高比映射到正确的 size", async () => {
    const png = makePngBuffer();
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ data: [{ b64_json: png.toString("base64") }] }),
    });

    await provider.generate({
      prompt: "test", aspectRatio: "3:4", outputFormat: "png",
      referenceImages: [], metadata: { batchId: "b1", jobId: "j1", outputRole: "hero" },
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.size).toBe("1024x1536");
  });
});
