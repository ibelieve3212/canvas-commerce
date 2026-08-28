import type { Application } from "@/contracts/application";

export const detailPageApp: Application = {
  id: "app_detail_page",
  slug: "detail-page",
  name: "AI 详情页",
  description: "一次生成 6 个详情页模块：首屏、卖点、场景、细节、功能、收尾。",
  kind: "DETAIL_PAGE",
  visibility: "PUBLIC",
  category: "DETAIL_POSTER",
  emojiIcon: "📑",
  tagline: "6 张成套详情页模块",
  tags: ["详情页", "长图"],
  outputConfig: { mode: "fixed", count: 6 },
  outputRoles: [
    { outputIndex: 1, outputRole: "hero", title: "首屏主视觉", description: "商品定位 + 核心利益点" },
    { outputIndex: 2, outputRole: "selling_points", title: "卖点总览", description: "3-5 个核心卖点" },
    { outputIndex: 3, outputRole: "scene", title: "场景代入", description: "真实使用场景" },
    { outputIndex: 4, outputRole: "material", title: "材质细节", description: "局部放大 + 工艺质感" },
    { outputIndex: 5, outputRole: "function", title: "功能证明", description: "参数、结构或效果说明" },
    { outputIndex: 6, outputRole: "closing", title: "收尾转化", description: "品牌信任 + 购买理由" },
  ],
  defaultAspectRatio: "3:4",
  formSchema: [
    { type: "image", key: "reference", label: "风格参考图（可选）", required: false, min: 0, max: 3, roles: ["style", "brand"], allowLibrary: true, group: "素材" },
    { type: "image", key: "product", label: "商品图", required: true, min: 1, max: 6, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：便携蓝牙音箱", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "text", key: "category", label: "类目", required: true, placeholder: "例：数码 / 音箱", maxLength: 60, defaultValue: "", group: "商品信息" },
    { type: "textarea", key: "selling_points", label: "商品卖点", required: true, placeholder: "核心卖点，每行一条", maxLength: 1000, defaultValue: "", group: "商品信息" },
    { type: "select", key: "platform", label: "平台", required: false, defaultValue: "taobao", group: "生成设置", options: [
      { label: "淘宝", value: "taobao" }, { label: "拼多多", value: "pinduoduo" }, { label: "抖音", value: "douyin" }, { label: "通用", value: "general" } ] },
    { type: "select", key: "market", label: "市场", required: false, defaultValue: "domestic", group: "生成设置", options: [
      { label: "国内", value: "domestic" }, { label: "东南亚", value: "sea" }, { label: "欧美", value: "west" } ] },
    { type: "select", key: "language", label: "语言", required: false, defaultValue: "zh", group: "生成设置", options: [
      { label: "中文", value: "zh" }, { label: "英文", value: "en" } ] },
    { type: "select", key: "style", label: "视觉风格", required: false, defaultValue: "clean", group: "生成设置", options: [
      { label: "极简干净", value: "clean" }, { label: "高端质感", value: "premium" }, { label: "活泼明亮", value: "lively" } ] },
    { type: "checkbox", key: "reference_layout", label: "参考同款版式", required: false, defaultValue: false, group: "生成设置" },
    { type: "text", key: "audience", label: "目标人群", required: false, placeholder: "例：年轻白领", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "price", label: "价格定位", required: false, placeholder: "例：中端 199-299", maxLength: 60, defaultValue: "", group: "高级要求" },
    { type: "text", key: "extra", label: "补充要求", required: false, placeholder: "其它特殊要求", maxLength: 200, defaultValue: "", group: "高级要求" },
    { type: "textarea", key: "copy", label: "图片文案", required: false, placeholder: "例：夏季新品限时特惠，留空则由 AI 自动生成", maxLength: 500, defaultValue: "", group: "高级要求" },
  ],
  promptTemplate:
    "{{ref_images}}电商详情页模块，商品 {{name}}（{{category}}），卖点 {{selling_points}}。平台 {{platform}}，市场 {{market}}，语言 {{language}}，风格 {{style}}。目标人群 {{audience}}，价格定位 {{price}}，补充 {{extra}}。{{copy_directive}}。{{output_directive}}{{#if reference_layout}}视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；但画面内容与构图仍按本张定位执行，不要复制参考图里的具体主体、人物或场景。商品使用商品图中的商品。{{/if}}上方卖点是整套详情页的全部信息，本张只取与本张定位相关的部分，不要全部堆上。保留模板排版安全区。",
  templateVersion: 5,
  isPublished: true,
};
