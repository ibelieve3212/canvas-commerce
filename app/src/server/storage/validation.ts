/**
 * 上传相关校验和工具。
 * - JPEG/PNG/WebP
 * - 单文件最大 15 MB
 * - 边长 256-8192 px
 * - SHA-256 计算
 */
import crypto from "node:crypto";

export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp"] as const;
export const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
export const MIN_DIMENSION = 256;
export const MAX_DIMENSION = 8192;

export function getExtFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "";
  }
}

export function validateMime(mime: string): boolean {
  return (ALLOWED_MIME as readonly string[]).includes(mime);
}

export function validateSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

export function computeSha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * 从 PNG/JPEG/WebP 文件头解析宽高，不需要额外依赖。
 * 超时或解析失败返回 null。
 */
export function parseImageDimensions(
  buf: Buffer,
): { width: number; height: number } | null {
  // PNG
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
  // JPEG — 扫描 SOF0/SOF2 标记
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      // SOF0=0xC0, SOF2=0xC2
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      offset += 2 + segLen;
    }
  }
  // WebP — RIFF
  if (
    buf.length >= 30 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    const chunk = buf.slice(12, 16).toString("ascii");
    if (chunk === "VP8 ") {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }
    if (chunk === "VP8L") {
      const b0 = buf[21];
      const b1 = buf[22];
      const b2 = buf[23];
      const b3 = buf[24];
      const width = 1 + ((b1 << 8) | b0);
      const height = 1 + ((b3 << 8) | (b2 & 0x3f));
      return { width, height };
    }
    if (chunk === "VP8X") {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width, height };
    }
  }
  return null;
}

export function validateDimensions(
  width: number,
  height: number,
): boolean {
  return (
    width >= MIN_DIMENSION &&
    width <= MAX_DIMENSION &&
    height >= MIN_DIMENSION &&
    height <= MAX_DIMENSION
  );
}
