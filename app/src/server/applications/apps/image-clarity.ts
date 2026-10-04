import type { Application } from "@/contracts/application";

/**
 * AI 变清晰（图片处理工具）：模糊低清图 → 清晰高质版。
 *
 * 走 AI Provider 重绘（与"AI"命名一致，mock 可测）。AI 重绘可能轻微
 * 改变文字/LOGO 细节，因此 prompt 强约束"细节与原图完全一致"。
 *
 * per_image 模式：任务 i 只处理上传的第 i 张图；输出比例跟随原图。
 */
export const imageClarityApp: Application = {
  id: "app_image_clarity",
  slug: "image-clarity",
  name: "AI 变清晰",
  description: "把模糊、低清的图片重绘为清晰锐利的高质量版本，文字 LOGO 尽量保持一致。",
  kind: "IMAGE_TOOL",
  visibility: "PUBLIC",
  category: "IMAGE",
  emojiIcon: "🔍",
  tagline: "模糊低清一键变高清",
  tags: ["变清晰", "高清", "锐化"],
  outputConfig: { mode: "per_image", max: 8 },
  outputRoles: [],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "source", label: "待清晰化图片（每张处理一次）", required: true, min: 1, max: 8, roles: ["product"], allowLibrary: true, group: "素材" },
  ],
  promptTemplate:
    "把图片重绘为高分辨率清晰版本：消除模糊、噪点与压缩痕迹，增强边缘锐度、材质纹理与细节层次，让画面清晰通透。要求：图中文字、LOGO、图案与商品细节与原图保持完全一致，逐字逐元素还原，不得改写、变形或增删任何内容，仅提升清晰度与质感。",
  templateVersion: 1,
  isPublished: true,
};
