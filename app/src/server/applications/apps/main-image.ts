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
  tagline: "勾选类型，生成对应数量的主图",
  tags: ["吸睛图", "场景图", "卖点图"],
  outputConfig: { mode: "roles" },
  // description 既是 UI 展示文案，也会原样进入 prompt（buildOutputDirective 直接拼进去）。
  // 所以 description 只写“这张图的任务”（位次职责，画面规格由 shot + 约束负责），
  // 避免同一句话在 prompt 里出现两遍稀释指令。
  // shot 是"画面骨架"（景别/机位/背景/主体构成）：5 张是 5 次独立调用，
  // 模型看不到同组其它张，必须把每张的骨架显式写死并互斥，否则会画成 5 张雷同图。
  //
  // 5 个角色对齐电商主图 5 个位次的行业分工（2026-10-22 查证）：
  // 第1位抢点击（白底/门面）→ 第2位场景代入 → 第3位卖点提炼 → 第4位对比破疑虑 → 第5位氛围促决策
  outputRoles: [
    { outputIndex: 1, outputRole: "hook", title: "吸睛主图", shot: "单品完整大特写·浅色纯色背景·居中占画面 60% 以上·无道具", description: "搜索页门面：让用户一眼看清这是什么，并点进来" },
    { outputIndex: 2, outputRole: "scene", title: "场景主图", shot: "使用中景·真实环境内·商品正在被使用或摆放·可有人物·环境元素丰富", description: "真实使用场景：让买家看懂什么时候用、谁来用" },
    { outputIndex: 3, outputRole: "selling_point", title: "卖点主图", shot: "局部微距·单一工艺点占主体·背景虚化·只露局部不露全貌", description: "提炼一个最强卖点：让买家看清做工" },
    { outputIndex: 4, outputRole: "compare", title: "对比主图", shot: "并置分区·对照双方各占一半·同背景同光线·差异点加标注", description: "对比破疑虑：让买家一眼看出和普通款的差别" },
    { outputIndex: 5, outputRole: "mood", title: "氛围主图", shot: "真实生活场景摆拍·暖色氛围光·商品占画面 40% 以上·道具与商品用途相关", description: "氛围促决策：用情绪和场景推动下单" },
  ],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "reference", label: "参考图（可选）", required: false, min: 0, max: 3, roles: ["style", "brand"], allowLibrary: true, group: "素材" },
    { type: "image", key: "product", label: "商品图 / 产品素材", required: true, min: 1, max: 6, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "image", key: "compare_ref", label: "对比素材（普通款 / 竞品图，可选）", required: false, min: 0, max: 1, roles: ["compare"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：便携蓝牙音箱", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "text", key: "category", label: "类目", required: true, placeholder: "例：数码 / 音箱", maxLength: 60, defaultValue: "", group: "商品信息" },
    { type: "textarea", key: "info", label: "商品信息", required: false, placeholder: "填写商品信息、卖点、参数；写明与普通款的差异，对比主图会用到", maxLength: 1000, defaultValue: "", group: "商品信息" },
    { type: "multiselect", key: "roles", label: "要生成的主图类型（勾选几种就生成几张）", required: false, defaultValues: ["hook", "scene", "selling_point", "compare", "mood"], maxItems: 5, group: "生成设置", options: [
      { label: "吸睛主图", value: "hook" },
      { label: "场景主图", value: "scene" },
      { label: "卖点主图", value: "selling_point" },
      { label: "对比主图", value: "compare" },
      { label: "氛围主图", value: "mood" } ] },
    { type: "select", key: "platform", label: "平台", required: false, defaultValue: "taobao", group: "生成设置", options: [
      { label: "淘宝", value: "taobao" }, { label: "拼多多", value: "pinduoduo" }, { label: "抖音", value: "douyin" }, { label: "通用", value: "general" } ] },
    { type: "select", key: "market", label: "市场", required: false, defaultValue: "domestic", group: "生成设置", options: [
      { label: "国内", value: "domestic" }, { label: "东南亚", value: "sea" }, { label: "欧美", value: "west" } ] },
    { type: "select", key: "language", label: "语言", required: false, defaultValue: "zh", group: "生成设置", options: [
      { label: "中文", value: "zh" }, { label: "英文", value: "en" }, { label: "中英", value: "zh-en" } ] },
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
      { label: "严格复刻参考图版式", value: "视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；复刻参考图的构图版式、主体位置、主体大小比例、机位视角、背景分层、留白和道具关系。参考图里的商品、人物、Logo、文字不能照搬为主体，只能把它们所在的位置和关系迁移给商品图里的商品。最终图必须以商品图中的商品为唯一主体，不能生成参考图里的商品；参考图与商品图的主体冲突时以商品图为准。" },
      { label: "只参考色调和氛围", value: "只借鉴已上传“风格/版式参考图”的色温、光影方向、虚实关系和氛围情绪，不复刻它的构图、主体位置和道具；参考图里的旧商品、旧包装、背景杂物和人物一律不得出现在结果里，也不要把参考图里旧商品的位置当成必须复刻的构图。" },
      { label: "不参考参考图", value: "" } ] },
  ],
  // 参考图规则（2026-10-22 改版）：从单一勾选框改成三档 select（见 formSchema.reference_rule），
  // value 直接是注入 prompt 的指令文本。模板里同时保留旧的 {{#if reference_layout}} 块：
  // 老批次的 formValues 里还有 reference_layout=true，重新生成时仍按旧语义（严格复刻）执行。
  promptTemplate:
    "{{ref_images}}电商主图，商品 {{name}}（{{category}}），平台 {{platform}}，市场 {{market}}，语言 {{language}}，风格 {{style}}。商品信息：{{info}}。目标人群 {{audience}}，价格定位 {{price}}。补充：{{extra}}。{{copy_directive}}。{{output_directive}}{{#if reference_layout}}视觉基调——色调、配色、光影、质感、排版风格——严格沿用已上传素材中的“风格/版式参考图”，忽略上面的风格选择；复刻参考图的构图版式、主体位置、主体大小比例、机位视角、背景分层、留白和道具关系。参考图里的商品、人物、Logo、文字不能照搬为主体，只能把它们所在的位置和关系迁移给商品图里的商品。最终图必须以商品图中的商品为唯一主体，不能生成参考图里的商品；参考图与商品图的主体冲突时以商品图为准。{{/if}}{{reference_rule}}每张都是一张可直接发布的 1:1 电商主图：只输出一个完整画面，不要做成多格排版的拼贴海报（对比图里两个商品并置同框是允许的，也不要做成 before/after 拼贴）。",
  templateVersion: 7,
  isPublished: true,
};
