import type { Application } from "@/contracts/application";

/**
 * 一键精修（图片处理工具）：对已有图片做光影/色彩/干净度增强。
 *
 * per_image 模式：任务 i 只处理上传的第 i 张图；输出比例跟随原图
 * 映射到最近的支持比例（服务端按上传图尺寸计算，无需用户选择）。
 */
export const imageRetouchApp: Application = {
  id: "app_image_retouch",
  slug: "image-retouch",
  name: "一键精修",
  description: "一键优化图片光影、色彩与干净度：去瑕疵、还原真实色彩，构图与内容不变。",
  kind: "IMAGE_TOOL",
  visibility: "PUBLIC",
  category: "IMAGE",
  emojiIcon: "✨",
  tagline: "光影 / 色彩 / 干净度一键增强",
  tags: ["精修", "去瑕疵", "色彩优化"],
  outputConfig: { mode: "per_image", max: 8 },
  outputRoles: [],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "source", label: "待精修图片（每张精修一次）", required: true, min: 1, max: 8, roles: ["product"], allowLibrary: true, group: "素材" },
  ],
  promptTemplate:
    "对图片做商品级精修：优化光影层次与对比度，校正色温还原真实色彩，清理画面中的污点、灰尘、划痕等瑕疵，适度增强清晰度让细节更扎实。要求：构图、商品、场景与原图保持一致，图中文字、LOGO、图案细节不得改写或增删，不做风格化改变，仅提升画面质感。",
  templateVersion: 1,
  isPublished: true,
};
