import type { Application } from "@/contracts/application";

export const posterApp: Application = {
  id: "app_poster",
  slug: "poster",
  name: "营销海报",
  description: "生成统一视觉系列海报，每张使用不同卖点。",
  kind: "POSTER",
  visibility: "PUBLIC",
  category: "DETAIL_POSTER",
  emojiIcon: "🎯",
  tagline: "1/2/4/6 张统一风格海报",
  tags: ["海报", "营销"],
  outputConfig: { mode: "selectable", options: [1, 2, 4, 6] },
  outputRoles: [],
  defaultAspectRatio: "3:4",
  formSchema: [
    { type: "image", key: "product", label: "商品素材", required: true, min: 1, max: 6, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "image", key: "brand", label: "品牌参考图（可选）", required: false, min: 0, max: 2, roles: ["brand"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：便携蓝牙音箱", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "textarea", key: "selling_points", label: "核心卖点（每行一条）", required: true, placeholder: "每行一条卖点，海报按卖点轮转", maxLength: 1000, defaultValue: "", group: "商品信息" },
    { type: "select", key: "style", label: "风格", required: false, defaultValue: "premium", group: "生成设置", options: [
      { label: "高端质感", value: "premium" }, { label: "极简", value: "minimal" }, { label: "活力促销", value: "promo" }, { label: "国潮", value: "national" } ] },
    { type: "select", key: "background", label: "背景", required: false, defaultValue: "solid", group: "生成设置", options: [
      { label: "纯色", value: "solid" }, { label: "渐变", value: "gradient" }, { label: "场景", value: "scene" }, { label: "抽象", value: "abstract" } ] },
    { type: "slider", key: "layout_random", label: "构图随机程度", required: false, min: 0, max: 100, step: 1, unit: "", defaultValue: 30, group: "生成设置" },
    { type: "radio", key: "aspect", label: "比例", required: false, defaultValue: "3:4", group: "生成设置", options: [
      { label: "1:1", value: "1:1" }, { label: "3:4", value: "3:4" }, { label: "9:16", value: "9:16" } ] },
    { type: "text", key: "audience", label: "目标人群", required: false, placeholder: "例：年轻白领", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "extra", label: "补充要求", required: false, placeholder: "其它特殊要求", maxLength: 200, defaultValue: "", group: "高级要求" },
    { type: "textarea", key: "copy", label: "图片文案", required: false, placeholder: "例：限时特惠，留空则由 AI 自动生成", maxLength: 500, defaultValue: "", group: "高级要求" },
  ],
  promptTemplate:
    "{{ref_images}}营销海报，商品 {{name}}，风格 {{style}}，背景 {{background}}，比例 {{aspect}}，构图随机 {{layout_random}}。卖点 {{selling_points}}，目标人群 {{audience}}，补充 {{extra}}。{{copy_directive}}。生成统一视觉系列的海报，保留排版安全区。",
  templateVersion: 1,
  isPublished: true,
};
