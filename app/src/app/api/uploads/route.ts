import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/session";
import { getStorage, makeObjectKey } from "@/server/storage/adapter";
import {
  validateMime,
  validateSize,
  validateDimensions,
  parseImageDimensions,
  computeSha256,
  getExtFromMime,
  ALLOWED_EXT,
} from "@/server/storage/validation";
import { generateThumbnail } from "@/server/storage/thumbnail";

/**
 * POST /api/uploads — 直接上传文件（local 存储模式）。
 * 阶段6可改为 presign + complete 两步。
 *
 * multipart/form-data: file=Blob, role=product|style|person|brand
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "未登录" }, requestId },
      { status: 401 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const role = (formData.get("role") as string) || "product";

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "缺少文件" }, requestId },
        { status: 400 },
      );
    }

    // MIME 校验：同时检查 Blob.type 和扩展名
    const mime = file.type;
    const originalName = (formData.get("name") as string) || file.name || "upload";
    const ext = originalName.split(".").pop()?.toLowerCase() ?? "";

    if (!validateMime(mime)) {
      return NextResponse.json(
        { error: { code: "INVALID_MIME", message: `不支持的文件类型：${mime}` }, requestId },
        { status: 400 },
      );
    }
    if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
      return NextResponse.json(
        { error: { code: "INVALID_EXT", message: `不支持的扩展名：${ext}` }, requestId },
        { status: 400 },
      );
    }

    // 大小校验
    if (!validateSize(file.size)) {
      return NextResponse.json(
        { error: { code: "FILE_TOO_LARGE", message: "文件超过 15MB 限制" }, requestId },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // 像素尺寸校验
    const dims = parseImageDimensions(buf);
    if (!dims) {
      return NextResponse.json(
        { error: { code: "INVALID_IMAGE", message: "无法解析图片尺寸" }, requestId },
        { status: 400 },
      );
    }
    if (!validateDimensions(dims.width, dims.height)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_DIMENSIONS",
            message: `图片尺寸需在 ${256}-${8192}px 之间，当前 ${dims.width}x${dims.height}`,
          },
          requestId,
        },
        { status: 400 },
      );
    }

    // SHA-256 去重（同用户相同文件复用）
    const sha256 = computeSha256(buf);
    const existing = await prisma.upload.findFirst({
      where: { userId: user.id, sha256 },
    });
    if (existing) {
      // 去重命中：检查老文件是否还在磁盘上（防老文件丢失）
      const storage = getStorage();
      const fileExists = await storage.exists(existing.objectKey);
      if (fileExists) {
        return NextResponse.json({
          data: {
            id: existing.id,
            objectKey: existing.objectKey,
            originalName: existing.originalName,
            mimeType: existing.mimeType,
            width: existing.width,
            height: existing.height,
            role,
          },
          requestId,
        });
      }
      // 老文件不存在：走到下方的存储逻辑，用新路径重新存储
    }

    // 存储
    const safeExt = getExtFromMime(mime);
    const objectKey = makeObjectKey(user.id, safeExt);
    const storage = getStorage();
    await storage.put(objectKey, buf);

    // 生成缩略图
    const thumbnailKey = await generateThumbnail(user.id, objectKey, buf, mime);

    // 创建记录
    const upload = await prisma.upload.create({
      data: {
        userId: user.id,
        objectKey,
        thumbnailKey,
        originalName,
        mimeType: mime,
        byteSize: buf.length,
        width: dims.width,
        height: dims.height,
        sha256,
      },
    });

    return NextResponse.json({
      data: {
        id: upload.id,
        objectKey: upload.objectKey,
        originalName: upload.originalName,
        mimeType: upload.mimeType,
        width: upload.width,
        height: upload.height,
        role,
      },
      requestId,
    });
  } catch (err) {
    console.error("[uploads] error:", err);
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: "上传失败" }, requestId },
      { status: 500 },
    );
  }
}
