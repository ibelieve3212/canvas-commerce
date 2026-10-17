import type { Application } from "@/contracts/application";

export const buyerShowApp: Application = {
  id: "app_buyer_show",
  slug: "buyer-show",
  name: "买家秀",
  description: "生成真实感买家秀，配置人物、场景、比例和真实度。",
  kind: "BUYER_SHOW",
  visibility: "PUBLIC",
  category: "SCENE_MODEL",
  emojiIcon: "📸",
  tagline: "1/2/4 张真实感买家秀",
  tags: ["买家秀", "场景", "人物"],
  outputConfig: { mode: "selectable", options: [1, 2, 4] },
  outputRoles: [],
  defaultAspectRatio: "4:5",
  formSchema: [
    { type: "image", key: "product", label: "商品图", required: true, min: 1, max: 4, roles: ["product"], allowLibrary: true, group: "素材" },
    { type: "image", key: "person", label: "参考人物图（可选）", required: false, min: 0, max: 2, roles: ["person"], allowLibrary: true, group: "素材" },
    { type: "image", key: "scene_ref", label: "参考场景图（可选）", required: false, min: 0, max: 2, roles: ["style"], allowLibrary: true, group: "素材" },
    { type: "text", key: "name", label: "商品名", required: true, placeholder: "例：智能手表", maxLength: 80, defaultValue: "", group: "商品信息" },
    { type: "select", key: "channel", label: "渠道", required: false, defaultValue: "taobao", group: "生成设置", options: [
      { label: "淘宝", value: "taobao" }, { label: "拼多多", value: "pinduoduo" }, { label: "抖音", value: "douyin" }, { label: "小红书", value: "xhs" } ] },
    { type: "select", key: "image_style", label: "影像风格", required: false, defaultValue: "casual", group: "生成设置", options: [
      { label: "随手拍", value: "casual" }, { label: "精修", value: "polished" }, { label: "国潮", value: "national" } ] },
    { type: "radio", key: "aspect", label: "比例", required: false, defaultValue: "4:5", group: "生成设置", options: [
      { label: "1:1", value: "1:1" }, { label: "4:5", value: "4:5" }, { label: "3:4", value: "3:4" } ] },
    { type: "radio", key: "person_visibility", label: "人物露出", required: false, defaultValue: "partial", group: "生成设置", options: [
      { label: "不露脸", value: "none" }, { label: "部分露脸", value: "partial" }, { label: "完整露脸", value: "full" } ] },
    { type: "slider", key: "realism", label: "真实度", required: false, min: 0, max: 100, step: 25, unit: "", defaultValue: 50, hintLow: "精致讲究", hintHigh: "素人随手拍", group: "生成设置", levels: [
      { value: 0, phrase: "画面精致干净，像用心拍摄的高质量生活照" },
      { value: 25, phrase: "整体干净讲究，带轻微生活气息" },
      { value: 50, phrase: "自然生活感，自然光下随手拍的松弛质感，人物状态真实放松" },
      { value: 75, phrase: "强真实感，手机随手拍质感，保留轻微噪点与真实肤质" },
      { value: 100, phrase: "极致真实，素人自拍感，像朋友圈里随手发的照片，毫无摆拍痕迹" },
    ] },
    { type: "text", key: "category", label: "类目", required: false, placeholder: "用于判断是否佩戴类", maxLength: 60, defaultValue: "", group: "商品信息" },
    { type: "checkbox", key: "lock_scale", label: "锁定佩戴尺度", required: false, defaultValue: false, group: "生成设置", showWhen: { field: "category", equals: "佩戴" } },
    { type: "text", key: "audience", label: "目标人群", required: false, placeholder: "例：年轻女性", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "scene", label: "场景", required: false, placeholder: "例：咖啡店、户外", maxLength: 100, defaultValue: "", group: "高级要求" },
    { type: "text", key: "extra", label: "补充要求", required: false, placeholder: "其它特殊要求", maxLength: 200, defaultValue: "", group: "高级要求" },
  ],
  promptTemplate:
    "{{ref_images}}买家秀，商品 {{name}}，类目 {{category}}，渠道 {{channel}}，影像风格 {{image_style}}，比例 {{aspect}}，人物露出 {{person_visibility}}，场景 {{scene}}，目标人群 {{audience}}。真实感：{{realism}}。补充 {{extra}}{{#if lock_scale}}，锁定商品在人物上的佩戴比例，保持真实尺度{{/if}}。{{output_directive}}生成自然真实感的买家秀照片。",
  templateVersion: 4,
  isPublished: true,
};
