/**
 * 缩略图生成服务。
 * 使用 sharp 将原图缩放到最大 300px 宽（保持比例），存储为独立对象键。
 *
 * OPT-3 精简后：缩略图 key 从原图 key 派生——把 .{ext} 换成 .thumb.jpg。
 * 不再生成新 uuid，不再字符串替换 category。
 */
import sharp from "sharp";
import { getStorage } from "@/server/storage/adapter";

const THUMB_MAX_WIDTH = 300;
const THUMB_QUALITY = 80;

/**
 * 从原图生成缩略图并存储，返回缩略图的对象键。
 * 缩略图 key = 原图 key 去掉扩展名 + ".thumb.jpg"
 * 例：{userId}/{uuid}.png → {userId}/{uuid}.thumb.jpg
 *
 * 如果原图本身很小，直接返回 null（无需缩略图）。
 */
export async function generateThumbnail(
  userId: string,
  sourceObjectKey: string,
  sourceBuffer: Buffer,
  _sourceMime: string,
): Promise<string | null> {
  try {
    const meta = await sharp(sourceBuffer).metadata();
    if (meta.width && meta.width <= THUMB_MAX_WIDTH) {
      return null; // 原图已足够小
    }

    const thumbBuffer = await sharp(sourceBuffer)
      .resize(THUMB_MAX_WIDTH, null, { withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY })
      .toBuffer();

    // 从原图 key 派生缩略图 key：去掉原扩展名，加 .thumb.jpg
    // 例：{userId}/{uuid}.png → {userId}/{uuid}.thumb.jpg
    const lastDot = sourceObjectKey.lastIndexOf(".");
    const lastSlash = sourceObjectKey.lastIndexOf("/");
    const thumbKey =
      lastDot > lastSlash
        ? sourceObjectKey.slice(0, lastDot) + ".thumb.jpg"
        : sourceObjectKey + ".thumb.jpg";

    await getStorage().put(thumbKey, thumbBuffer);
    return thumbKey;
  } catch (err) {
    console.error("[thumbnail] generation failed:", err);
    return null;
  }
}
