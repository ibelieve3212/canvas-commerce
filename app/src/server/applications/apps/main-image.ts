import type { Application } from "@/contracts/application";

export const mainImageApp: Application = {
  id: "app_main_image",
  slug: "main-image",
  name: "商品主图",
  description: "生成符合电商规范的 1/3/5 张主图，支持吸睛、场景、卖点、对比、氛围。",
  kind: "MAIN_IMAGE",
  visibility: "PUBLIC",
  category: "BATCH",
  emojiIcon: "🖼️",
  tagline: "1/3/5 张可直接发布的主图",
  tags: ["吸睛图", "场景图", "卖点图"],
  outputConfig: { mode: "selectable", options: [1, 3, 5] },
  outputRoles: [
    { outputIndex: 1, outputRole: "hero", title: "吸睛主图", description: "高点击率首图，视觉冲击+利益引导" },
    { outputIndex: 2, outputRole: "scene", title: "场景主图", description: "商品在真实使用场景中，增强代入感" },
    { outputIndex: 3, outputRole: "selling_point", title: "卖点主图", description: "突出一个核心卖点" },
    { outputIndex: 4, outputRole: "compare", title: "对比主图", description: "使用前后或与普通版对比（5 张启用）" },
    { outputIndex: 5, outputRole: "mood", title: "氛围主图", description: "节日/促销/季节氛围（5 张启用）" },
  ],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "reference", label: "参考图（可选）", required: false, min: 0, max: 3, roles: ["style", "brand"], allowLibrary: true, group: "素材" },
    { type: "image", key: "product", label: "商品图 / 产品素材", required: true, min: 1, max: 6, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：便携蓝牙音箱", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "text", key: "category", label: "类目", required: true, placeholder: "例：数码 / 音箱", maxLength: 60, defaultValue: "", group: "商品信息" },
    { type: "textarea", key: "info", label: "商品信息", required: false, placeholder: "填写商品信息、卖点、参数", maxLength: 1000, defaultValue: "", group: "商品信息" },
    { type: "select", key: "platform", label: "平台", required: false, defaultValue: "taobao", group: "生成设置", options: [
      { label: "淘宝", value: "taobao" }, { label: "拼多多", value: "pinduoduo" }, { label: "抖音", value: "douyin" }, { label: "通用", value: "general" } ] },
    { type: "select", key: "market", label: "市场", required: false, defaultValue: "domestic", group: "生成设置", options: [
      { label: "国内", value: "domestic" }, { label: "东南亚", value: "sea" }, { label: "欧美", value: "west" } ] },
    { type: "select", key: "language", label: "语言", required: false, defaultValue: "zh", group: "生成设置", options: [
      { label: "中文", value: "zh" }, { label: "英文", value: "en" }, { label: "中英", value: "zh-en" } ] },
    { type: "select", key: "style", label: "视觉风格", required: false, defaultValue: "clean", group: "生成设置", options: [
      { label: "极简干净", value: "clean" }, { label: "高端质感", value: "premium" }, { label: "活泼明亮", value: "lively" }, { label: "国潮", value: "national" } ] },
    { type: "text", key: "audience", label: "目标人群", required: false, placeholder: "例：年轻白领", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "price", label: "价格定位", required: false, placeholder: "例：中端 199-299", maxLength: 60, defaultValue: "", group: "高级要求" },
    { type: "text", key: "extra", label: "补充要求", required: false, placeholder: "其它特殊要求", maxLength: 200, defaultValue: "", group: "高级要求" },
    { type: "textarea", key: "copy", label: "图片文案", required: false, placeholder: "例：夏季新品限时特惠，留空则由 AI 自动生成", maxLength: 500, defaultValue: "", group: "高级要求" },
    { type: "checkbox", key: "reference_layout", label: "同款参考版式", required: false, defaultValue: false, group: "高级要求" },
  ],
  promptTemplate:
    "{{ref_images}}电商主图，商品 {{name}}（{{category}}），平台 {{platform}}，市场 {{market}}，语言 {{language}}，风格 {{style}}。商品信息：{{info}}。目标人群 {{audience}}，价格定位 {{price}}。补充：{{extra}}。{{copy_directive}}。{{output_directive}}{{#if reference_layout}}视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；但画面内容与构图仍按本张定位执行，不要复制参考图里的具体主体、人物或场景。商品使用商品图中的商品。{{/if}}突出商品最佳角度，画面干净可直接发布。",
  templateVersion: 4,
  isPublished: true,
};
