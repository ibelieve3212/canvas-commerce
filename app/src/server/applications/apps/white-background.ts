import type { Application } from "@/contracts/application";

/**
 * 白底图（图片处理工具）：把商品图重绘为纯白背景的电商规范主图。
 *
 * per_image 模式：一次提交 N 张 = N 个任务，任务 i 只处理第 i 张图。
 * 每个任务随快照记录自己的源图与比例，互不影响、可按张重试。
 */
export const whiteBackgroundApp: Application = {
  id: "app_white_background",
  slug: "white-background",
  name: "白底图",
  description: "把商品图放到纯白背景上，输出符合电商主图规范的白底图，可批量处理。",
  kind: "IMAGE_TOOL",
  visibility: "PUBLIC",
  category: "IMAGE",
  emojiIcon: "⚪",
  tagline: "抠图换纯白底，一张一任务",
  tags: ["抠图", "电商规范", "批量"],
  outputConfig: { mode: "per_image", max: 8 },
  // 角色由 computeOutputRoles 按"第 N 张"动态生成，这里不预置
  outputRoles: [],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "source", label: "商品图（每张生成一张白底图）", required: true, min: 1, max: 8, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "radio", key: "aspect", label: "输出比例", required: false, defaultValue: "1:1", group: "输出设置", options: [
      { label: "1:1（主图标准）", value: "1:1" },
      { label: "4:5", value: "4:5" },
      { label: "3:4", value: "3:4" },
    ] },
  ],
  promptTemplate:
    "对图片中商品做抠图换背景：精确保留商品本体，将背景替换为纯白色（#FFFFFF），完全去除原有背景、阴影和杂物。要求：商品置于画面中央，占画面约 80%，完整无裁切；商品细节、颜色、文字、LOGO 与原图保持完全一致，不得改写或增删任何内容；边缘干净无白边，商品可保留极轻微的接触阴影以显真实。输出比例 {{aspect}}。可直接用作电商白底主图。",
  templateVersion: 1,
  isPublished: true,
};
