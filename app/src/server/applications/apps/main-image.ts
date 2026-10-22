import type { Application } from "@/contracts/application";

/**
 * 商品主图 —— 全套移植 QQ1000「套图一键生成」（listing-bundle）的主图部分。
 *
 * 来源：tu.qq1000.com 前端 chunk `3mfbh2131txdk.js` 偏移 219021-219750
 * （提取件见 E:/Workspace/qq1000-reference/prompts/tools/listing-bundle.md）
 *
 * 为什么换掉上一版（5 个位次 + 角色级长约束）：
 * 上一版每张图的指令量 701-1020 字（含画面骨架清单、兄弟图清单、多 SKU 规则、
 * 禁列表），而 QQ1000 每张只有约 110 字。实测结果与密度成反比——
 * 指令最少的吸睛/场景/卖点三张出图正常，指令最多的对比图（930 字）
 * 和氛围图（1020 字）双双跑偏（对比图变成大小不一散着放、氛围图出现
 * 橙子片肉桂棒等无关道具）。所以这一版只保留「一句位次意图」，
 * 画面骨架不再写死：写死骨架反而制造问题（"多件成组散落"这句就是
 * 氛围图商品被裁到画面边缘的直接原因）。
 *
 * 位次名与描述一字不改照搬 QQ1000，方便与上游对照。
 */
export const mainImageApp: Application = {
  id: "app_main_image",
  slug: "main-image",
  name: "商品主图",
  description: "10 类电商主图，勾选需要的类型，一类生成一张。",
  kind: "MAIN_IMAGE",
  visibility: "PUBLIC",
  category: "BATCH",
  emojiIcon: "🖼️",
  tagline: "勾选类型，生成对应数量的主图",
  tags: ["主图", "套图", "白底图", "场景图"],
  outputConfig: { mode: "roles" },
  // 10 个位次对齐 QQ1000 套图的主图分工，用户勾几种就生成几张。
  // description 会原样进 prompt（buildOutputDirective 直接拼进去），
  // 所以这里就是模型看到的位次意图。
  //
  // shot（画面骨架）一律留空：QQ1000 不写骨架，位次意图本身互斥就够；
  // 而写死骨架反而制造问题（“多件成组散落”让商品被裁到画面边缘）。
  // outputRole 加 main_ 前缀：详情页的 6 个位次里有同名 role（scene 等），
  // 共用一张 roleConstraints 表会互相污染（详情页场景图要求“配点题文案”，
  // 主图不需要），加前缀彻底隔离。
  outputRoles: ([
    { outputIndex: 1, outputRole: "main_hot_click", title: "高点击首图", description: "高点击首图：主体大、卖点集中、移动端缩略图第一眼看清商品和核心利益点" },
    { outputIndex: 2, outputRole: "main_white_bg", title: "白底质感主图", description: "白底质感主图：纯净白底、柔和落地阴影、突出材质和体积感，适合跨境平台" },
    { outputIndex: 3, outputRole: "main_scene", title: "场景主图", description: "场景主图：把商品放入真实使用场景，但不要带入商品原图背景" },
    { outputIndex: 4, outputRole: "main_promotion", title: "促销转化主图", description: "促销转化主图：强调套装、价格带、活动氛围或购买理由，文案区域留白" },
    { outputIndex: 5, outputRole: "main_premium", title: "高端品牌主图", description: "高端品牌主图：极简构图、克制光影、强调品质和高级感" },
    { outputIndex: 6, outputRole: "main_detail_point", title: "细节卖点主图", description: "细节卖点主图：突出一个关键结构/功能/材质细节，仍保持单张完整主图" },
    { outputIndex: 7, outputRole: "main_pain_point", title: "人群痛点主图", description: "人群痛点主图：围绕目标人群和使用痛点设计画面，不夸大功效" },
    { outputIndex: 8, outputRole: "main_mood", title: "对比氛围主图", description: "对比氛围主图：通过背景层次和光影体现升级感，不做左右对比拼图" },
    { outputIndex: 9, outputRole: "main_gift", title: "礼盒/套装主图", description: "礼盒/套装主图：如果商品适合礼盒或套装，展示完整购买感" },
    { outputIndex: 10, outputRole: "main_platform", title: "平台适配主图", description: "平台适配主图：按平台审美做清晰、干净、转化导向画面" },
  ] as const).map((r) => ({ ...r, shot: "" })),
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "reference", label: "参考图（可选）", required: false, min: 0, max: 3, roles: ["style", "brand"], allowLibrary: true, group: "素材" },
    { type: "image", key: "product", label: "商品图 / 产品素材", required: true, min: 1, max: 6, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：便携蓝牙音箱", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "text", key: "category", label: "类目", required: true, placeholder: "例：数码 / 音箱", maxLength: 60, defaultValue: "", group: "商品信息" },
    { type: "textarea", key: "info", label: "商品信息", required: false, placeholder: "填写商品信息、卖点、参数，主图会据此提炼文案", maxLength: 1000, defaultValue: "", group: "商品信息" },
    { type: "multiselect", key: "roles", label: "要生成的主图类型（勾选几种就生成几张）", required: false, defaultValues: [], maxItems: 10, group: "生成设置", options: [
      { label: "高点击首图", value: "main_hot_click" },
      { label: "白底质感主图", value: "main_white_bg" },
      { label: "场景主图", value: "main_scene" },
      { label: "促销转化主图", value: "main_promotion" },
      { label: "高端品牌主图", value: "main_premium" },
      { label: "细节卖点主图", value: "main_detail_point" },
      { label: "人群痛点主图", value: "main_pain_point" },
      { label: "对比氛围主图", value: "main_mood" },
      { label: "礼盒/套装主图", value: "main_gift" },
      { label: "平台适配主图", value: "main_platform" } ] },
    { type: "checkbox", key: "include_selling_points", label: "主图带卖点文字", required: false, defaultValue: true, group: "生成设置" },
    // value 用中文：composePrompt 只做简单替换，value 才是模型读到的文字。
    // 英文键名（taobao/zh）模型只能猜，尤其影响“平台适配主图”这类
    // 靠平台审美吃饭的位次。
    { type: "select", key: "platform", label: "平台", required: false, defaultValue: "淘宝", group: "生成设置", options: [
      { label: "淘宝", value: "淘宝" }, { label: "拼多多", value: "拼多多" }, { label: "抖音", value: "抖音" }, { label: "通用", value: "通用电商平台" } ] },
    { type: "select", key: "market", label: "市场", required: false, defaultValue: "国内", group: "生成设置", options: [
      { label: "国内", value: "国内" }, { label: "东南亚", value: "东南亚" }, { label: "欧美", value: "欧美" } ] },
    { type: "select", key: "language", label: "语言", required: false, defaultValue: "中文", group: "生成设置", options: [
      { label: "中文", value: "中文" }, { label: "英文", value: "英文" }, { label: "中英", value: "中英双语" } ] },
    { type: "select", key: "style", label: "视觉风格", required: false, defaultValue: "极简干净：极简构图、大面积留白、柔和均匀的浅色背景、不堆砌装饰", group: "生成设置", options: [
      // value 会原样进 prompt（composePrompt 只做简单替换，value 才是模型看到的文本），
      // label 仍显示短名给用户看。原英文值（clean/premium）模型读不出画面要求，
      // 这里直接把 value 写成可执行的画面规格。
      { label: "极简干净", value: "极简干净：极简构图、大面积留白、柔和均匀的浅色背景、不堆砌装饰" },
      { label: "高端质感", value: "高端质感：克制构图、低饱和配色、方向明确的高光与暗部、强调材质与做工细节" },
      { label: "活泼明亮", value: "活泼明亮：高明度对比色、跳跃的色块与光斑、背景干净但氛围轻快" },
      { label: "国潮", value: "国潮：传统纹样与国潮配色、扁平装饰图形点缀、构图对称且有节庆感" } ] },
    { type: "text", key: "audience", label: "目标人群", required: false, placeholder: "例：年轻白领", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "price", label: "价格定位", required: false, placeholder: "例：中端 199-299", maxLength: 60, defaultValue: "", group: "高级要求" },
    { type: "text", key: "extra", label: "补充要求", required: false, placeholder: "其它特殊要求", maxLength: 200, defaultValue: "", group: "高级要求" },
    { type: "textarea", key: "copy", label: "图片文案", required: false, placeholder: "例：夏季新品限时特惠，留空则由 AI 自动生成", maxLength: 500, defaultValue: "", group: "高级要求" },
    { type: "select", key: "reference_rule", label: "参考图用法", required: false, defaultValue: "", group: "高级要求", options: [
      // value 直接写指令文本（composePrompt 只做简单替换，value 才是模型看到的）。
      // 三档取代原来的"同款参考版式"勾选框：勾选只能二选一，用户没法表达
      // "我只想参考它的色调"。旧勾选框的语义（严格复刻）已由第一档覆盖。
      { label: "严格复刻参考图版式", value: "视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；复刻参考图的构图版式、主体位置、主体大小比例、机位视角、背景分层、留白和道具关系。参考图里的商品、人物、Logo、文字不能照搬为主体，只能把它们所在的位置和关系迁移给商品图里的商品。最终图必须以商品图中的商品为唯一主体，不能生成参考图里的商品；参考图与商品图的主体冲突时以商品图为准。\n" },
      { label: "只参考色调和氛围", value: "只借鉴已上传“风格/版式参考图”的色温、光影方向、虚实关系和氛围情绪，不复刻它的构图、主体位置和道具；参考图里的旧商品、旧包装、背景杂物和人物一律不得出现在结果里，也不要把参考图里旧商品的位置当成必须复刻的构图。\n" },
      { label: "不参考参考图", value: "" } ] },
  ],
  // prompt 骨架对照 QQ1000 的装配结果（应用行 + 用户需求字段行 + 位次意图
  // + 少量通用规则 + 画面比例 + 输出要求 + 全局画质块）：
  //   {{output_directive}} 只含"第 N 张/共 M 张 + 一句位次意图"
  //   {{selling_points_directive}} 由 service.ts 按"主图带卖点文字"开关注入
  //   {{ref_images}} 由 composePrompt 按实际发图顺序生成"第N张为…"
  // 模板里保留旧的 {{#if reference_layout}} 块：老批次 formValues 里还有
  // reference_layout=true，重新生成时仍按旧语义（严格复刻）执行。
  promptTemplate:
    "{{ref_images}}应用：商品主图\n" +
    "用户需求：\n" +
    "{{output_directive}}\n" +
    "商品：{{name}}\n" +
    "类目：{{category}}\n" +
    "平台：{{platform}}\n" +
    "市场：{{market}}\n" +
    "画面语言：{{language}}\n" +
    "风格：{{style}}\n" +
    "{{selling_points_directive}}\n" +
    "目标人群：{{audience}}\n" +
    "价格定位：{{price}}\n" +
    "{{copy_directive}}\n" +
    "补充要求：{{extra}}\n" +
    "{{reference_rule}}{{#if reference_layout}}视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；复刻参考图的构图版式、主体位置、主体大小比例、机位视角、背景分层、留白和道具关系。参考图里的商品、人物、Logo、文字不能照搬为主体，只能把它们所在的位置和关系迁移给商品图里的商品。最终图必须以商品图中的商品为唯一主体，不能生成参考图里的商品；参考图与商品图的主体冲突时以商品图为准。{{/if}}\n" +
    "只生成一张独立电商主图，不要拼图、不要多宫格、不要生成详情页长图。\n" +
    "商品图里的商品是唯一主体，严格保留商品的外观、形状、颜色、材质、比例、Logo/纹理位置和关键细节；商品原图背景无效，不能带入结果。\n" +
    "如果上传了参考图，参考图只用于构图、光影、留白和视觉风格，不要照搬参考图里的商品、人物、品牌元素和文字。\n" +
    "商品图里有多个款式或颜色时，本张只呈现其中 1-2 个，不要把全部款式平铺成一片。\n" +
    "画面比例必须适配本张比例。\n" +
    "输出要求：结果必须符合应用目标，画面清晰真实，商业可用。\n" +
    "最高优先级画质要求：必须生成超清高质量成片，图片质量最高，细节拉满，主体边缘干净锐利，材质纹理、光影层次、色彩过渡和局部细节都要清晰可见；避免低清、糊图、噪点、压缩感、涂抹感、过度磨皮、边缘毛糙和伪影。",
  templateVersion: 8,
  isPublished: true,
};
