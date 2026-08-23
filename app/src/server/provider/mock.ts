/**
 * Mock Provider：生成可识别占位图。
 * - 固定 seed 产生确定性图案（保证 E2E 稳定）
 * - 模拟 0.8-2.5 秒延迟
 * - 可注入指定 Job 失败
 *
 * 不依赖网络。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import type {
  ImageGenerationProvider,
  ProviderImageRequest,
  ProviderImageResult,
} from "./types";
import { ProviderError } from "./types";
import crypto from "node:crypto";

/** 全局故障注入：Set<jobId> 中的 Job 将失败。测试用。 */
const failureInjection = new Set<string>();

export function injectMockFailure(jobId: string) {
  failureInjection.add(jobId);
}

export function clearMockFailures() {
  failureInjection.clear();
}

function aspectToDimensions(aspect: string): { width: number; height: number } {
  switch (aspect) {
    case "1:1":
      return { width: 1024, height: 1024 };
    case "4:5":
      return { width: 820, height: 1024 };
    case "3:4":
      return { width: 768, height: 1024 };
    case "16:9":
      return { width: 1024, height: 576 };
    case "9:16":
      return { width: 576, height: 1024 };
    default:
      return { width: 1024, height: 1024 };
  }
}

/**
 * 生成一个最小有效 PNG（纯色 + 简单图案）。
 * 不用 canvas 库——直接构造 PNG 文件字节。
 * 用 seed 决定颜色，便于识别。
 */
function generatePlaceholderPng(
  width: number,
  height: number,
  seed: string,
  label: string,
): Buffer {
  // 用 seed 生成颜色
  const hash = crypto.createHash("md5").update(seed).digest();
  const r = hash[0];
  const g = hash[1];
  const b = hash[2];

  // 构造 raw pixel data（每行加 filter byte 0）
  const rowSize = width * 4 + 1; // RGBA + filter
  const rawSize = rowSize * height;
  const raw = Buffer.alloc(rawSize);

  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const off = y * rowSize + 1 + x * 4;
      // 渐变：用位置插值产生可识别图案
      const t = (x + y) / (width + height);
      raw[off] = Math.min(255, Math.floor(r * (0.5 + t * 0.5)));
      raw[off + 1] = Math.min(255, Math.floor(g * (0.5 + (1 - t) * 0.5)));
      raw[off + 2] = Math.min(255, Math.floor(b * (0.7 + t * 0.3)));
      raw[off + 3] = 255;
    }
  }

  // 压缩 raw 用 zlib deflate
  const zlib = require("node:zlib");
  const compressed = zlib.deflateSync(raw);

  // 组装 PNG
  const chunks: Buffer[] = [];
  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  function chunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crc = require("node:zlib").crc32(crcInput);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(chunk("IHDR", ihdr));

  // IDAT
  chunks.push(chunk("IDAT", compressed));

  // IEND
  chunks.push(chunk("IEND", Buffer.alloc(0)));

  // 在 tEXt 写入 label 和 seed（便于测试识别）
  const textData = Buffer.from(`seed\x00${seed}\x00label\x00${label}`, "latin1");
  // 插入到 IHDR 之后
  chunks.splice(2, 0, chunk("tEXt", textData));

  return Buffer.concat(chunks);
}

class MockImageProvider implements ImageGenerationProvider {
  readonly name = "mock";

  async generate(
    request: ProviderImageRequest,
    signal?: AbortSignal,
  ): Promise<ProviderImageResult> {
    const { jobId } = request.metadata;

    // 故障注入
    if (failureInjection.has(jobId)) {
      // 模拟延迟后失败
      await delay(500);
      failureInjection.delete(jobId);
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Mock 注入故障：模拟 Provider 不可用",
        true,
      );
    }

    // Prompt 触发故障（E2E 测试用：商品名包含 __FAIL__ 时该 job 失败）
    if (request.prompt.includes("__FAIL__")) {
      await delay(300);
      throw new ProviderError(
        "PROVIDER_UNAVAILABLE",
        "Mock 测试故障：prompt 含 __FAIL__ 标记",
        true,
      );
    }

    // 随机延迟 0.8-2.5 秒
    await delay(800 + Math.random() * 1700);

    if (signal?.aborted) {
      throw new ProviderError("PROVIDER_TIMEOUT", "请求被取消", true);
    }

    const { width, height } = aspectToDimensions(request.aspectRatio);
    const seed = `${jobId}:${request.metadata.outputRole || "default"}`;
    const label = `${request.metadata.batchId.slice(0, 8)}-${request.metadata.outputRole}`;

    const imageBuffer = generatePlaceholderPng(width, height, seed, label);

    return {
      imageBuffer,
      mimeType: "image/png",
      width,
      height,
      revisedPrompt: `[mock] ${request.prompt.slice(0, 100)}`,
      providerRequestId: `mock-${crypto.randomUUID().slice(0, 8)}`,
      usage: { mock: true },
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockProvider = new MockImageProvider();
