import type { Application } from "@/contracts/application";

/**
 * 一键精修（图片处理工具）：商品级精修——修瑕（含反光倒影清理）、
 * 光影重塑、材质质感增强。三个力度滑条可调，适配不同材质的商品：
 * 镜面金属把反光拉满、织物把反光关掉把质感拉高，全靠用户裁量。
 * 滑条通过 levels 档位语义把数值翻译成给模型的明确指令短语。
 *
 * per_image 模式：任务 i 只处理上传的第 i 张图；输出比例跟随原图
 * 映射到最近的支持比例（服务端按上传图尺寸计算，无需用户选择）。
 */
export const imageRetouchApp: Application = {
  id: "app_image_retouch",
  slug: "image-retouch",
  name: "一键精修",
  description:
    "商品级精修：去瑕疵、清理镜面反光里的人影杂物、重塑光影、按材质增强质感，力度可调，构图与内容不变。",
  kind: "IMAGE_TOOL",
  visibility: "PUBLIC",
  category: "IMAGE",
  emojiIcon: "✨",
  tagline: "修瑕 / 反光 / 光影 / 质感，力度可调",
  tags: ["精修", "去瑕疵", "反光清理", "质感增强"],
  outputConfig: { mode: "per_image", max: 8 },
  outputRoles: [],
  defaultAspectRatio: "1:1",
  formSchema: [
    { type: "image", key: "source", label: "待精修图片（每张精修一次）", required: true, min: 1, max: 8, roles: ["product"], allowLibrary: true, group: "素材" },
    {
      type: "slider",
      key: "reflection",
      label: "反光清理",
      unit: "",
      required: false,
      min: 0,
      max: 100,
      step: 25,
      defaultValue: 50,
      hintLow: "保留原样",
      hintHigh: "彻底清理",
      group: "精修力度",
      levels: [
        { value: 0, phrase: "完全保留原图中的反光与倒影，不做清理" },
        { value: 25, phrase: "只清理反光中最突兀的杂物倒影，其余保持原样" },
        { value: 50, phrase: "清理镜面与金属反光中映出的环境杂物、人影、拍摄器材等杂乱倒影，替换为干净柔和的自然反光，材质本身的光泽与漂亮的高光保留" },
        { value: 75, phrase: "把反光面上的杂乱倒影全部清理，替换为影棚感的干净反光，只保留材质光泽与高光结构" },
        { value: 100, phrase: "反光面处理成理想影棚效果：不留任何环境倒影，只有干净渐变的高光与反光" },
      ],
    },
    {
      type: "slider",
      key: "relight",
      label: "光影重塑",
      unit: "",
      required: false,
      min: 0,
      max: 100,
      step: 25,
      defaultValue: 50,
      hintLow: "保持原片",
      hintHigh: "影棚布光",
      group: "精修力度",
      levels: [
        { value: 0, phrase: "光影完全保持原片，不做调整" },
        { value: 25, phrase: "轻微增强明暗对比，画面层次略清晰" },
        { value: 50, phrase: "顺着原片光源方向增强光影层次：受光面与背光面分明，高光沿商品曲面自然展开，体积感与结构转折更清楚" },
        { value: 75, phrase: "明显重塑光影：立体感强，明暗过渡干净利落，接近专业布光效果" },
        { value: 100, phrase: "按商业大片标准重塑光影：强立体感、干净利落的明暗结构，如同专业影棚拍摄" },
      ],
    },
    {
      type: "slider",
      key: "texture",
      label: "质感强化",
      unit: "",
      required: false,
      min: 0,
      max: 100,
      step: 25,
      defaultValue: 50,
      hintLow: "维持原样",
      hintHigh: "广告级",
      group: "精修力度",
      levels: [
        { value: 0, phrase: "材质质感维持原片，不额外强化" },
        { value: 25, phrase: "轻微强化材质细节" },
        { value: 50, phrase: "按商品实际材质增强质感：金属光泽干净锐利，玻璃与透明材质通透、边缘与内部结构分明，织物皮革纹理清晰" },
        { value: 75, phrase: "材质对比与细节纹理显著增强，接近广告图水准" },
        { value: 100, phrase: "质感做到广告级：材质细节锐利突出，但不得改变商品本身的设计、颜色与工艺" },
      ],
    },
  ],
  promptTemplate:
    "对图片做商品级精修：清理画面中的污点、灰尘、划痕等瑕疵，校正色温还原真实色彩，适度增强清晰度让细节更扎实。反光：{{reflection}}。光影：{{relight}}。质感：{{texture}}。磨砂、拉丝等表面工艺是商品的设计特征，不得当作瑕疵磨平。要求：构图、商品、场景与原图保持一致，图中文字、LOGO、图案细节不得改写或增删，不做风格化改变，不过度美化到与实物不符。",
  templateVersion: 2,
  isPublished: true,
};
