/**
 * 生成输入 DTO 和批次创建请求契约。
 */
import { z } from "zod";
import { AspectRatioSchema } from "./application";

/** 单张参考图的关联引用。提交时使用 uploadId + role。 */
export const ReferenceImageInputSchema = z.object({
  uploadId: z.string(),
  role: z.enum(["product", "style", "person", "brand"]),
});
export type ReferenceImageInput = z.infer<typeof ReferenceImageInputSchema>;

/** 输出选择：selectable 模式下用户选择的数量。固定模式不传。 */
export const OutputSelectionSchema = z
  .object({
    count: z.number().int().min(1).max(6).optional(),
    options: z.array(z.string()).optional(),
  })
  .optional()
  .default({});

/** 用户填写的表单字段值（粗糙接收，后续按 FormSchema 校验）。key -> value */
export const FormValuesSchema = z.record(z.string(), z.unknown());
export type FormValues = z.infer<typeof FormValuesSchema>;

/** 批次创建请求。 */
export const CreateGenerationBatchSchema = z.object({
  applicationId: z.string(),
  formValues: FormValuesSchema,
  referenceImages: z.array(ReferenceImageInputSchema).default([]),
  aspectRatio: AspectRatioSchema.default("1:1"),
  outputSelection: OutputSelectionSchema,
  /** 幂等键：同用户相同 idempotencyKey 只创建一个 Batch。 */
  idempotencyKey: z.string().max(128).optional(),
  parentBatchId: z.string().optional(),
});
export type CreateGenerationBatch = z.infer<typeof CreateGenerationBatchSchema>;

/** Prom 中支持的变量替换：{{key}} 仅允许已在 form 中声明且通过 keyRegex 的标识。 */
export const promptVarRegex = /\{\{([a-z][a-z0-9_]*)\}\}/g;
export const promptVarKeyRegex = /^[a-z][a-z0-9_]*$/;

/** 条件块语法：{{#if key}}...{{/if}}，key 为 true 时渲染内容，否则删除。 */
export const promptIfBlockRegex =
  /\{\{#if\s+([a-z][a-z0-9_]*)\}\}([\s\S]*?)\{\{\/if\}\}/g;

/** 生成输入快照：批次提交时冻结，后续不变。 */
export const GenerationInputSnapshotSchema = z.object({
  applicationId: z.string(),
  formValues: FormValuesSchema,
  referenceImages: z.array(
    z.object({
      uploadId: z.string(),
      role: ReferenceImageInputSchema.shape.role,
      objectKey: z.string().optional(),
      originalName: z.string().optional(),
    }),
  ),
  aspectRatio: AspectRatioSchema,
  outputSelection: OutputSelectionSchema,
  promptTemplate: z.string(),
  templateVersion: z.number().int(),
  createdAt: z.string(),
});
export type GenerationInputSnapshot = z.infer<
  typeof GenerationInputSnapshotSchema
>;

/** 根据字段 Schema 校验 formValues 的输出。 */
export function validateFormValues(
  formSchema: import("./application").FormSchema,
  values: FormValues,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const field of formSchema) {
    const value = values[field.key];
    if (field.required) {
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
        errors[field.key] = `${field.label}为必填`;
        continue;
      }
    }
    if (value === undefined || value === null || value === "") continue;

    switch (field.type) {
      case "text":
      case "textarea":
        if (typeof value !== "string") {
          errors[field.key] = `${field.label}格式错误`;
        } else if (value.length > field.maxLength) {
          errors[field.key] = `${field.label}超出最大长度 ${field.maxLength}`;
        }
        break;
      case "select":
      case "radio":
        if (
          typeof value === "string" &&
          !field.options.some((o: { value: string }) => o.value === value)
        ) {
          errors[field.key] = `${field.label}选项无效`;
        }
        break;
      case "multiselect":
        if (
          Array.isArray(value) &&
          value.length > field.maxItems
        ) {
          errors[field.key] = `${field.label}最多选 ${field.maxItems} 项`;
        } else if (
          Array.isArray(value) &&
          !value.every((v: string) =>
            field.options.some((o: { value: string }) => o.value === v),
          )
        ) {
          errors[field.key] = `${field.label}含无效选项`;
        }
        break;
      case "slider":
        if (typeof value === "number") {
          if (value < field.min || value > field.max) {
            errors[field.key] = `${field.label}应在 ${field.min}-${field.max}`;
          }
        }
        break;
      case "checkbox":
        if (typeof value !== "boolean") {
          errors[field.key] = `${field.label}应为布尔值`;
        }
        break;
      case "image":
        // 阶段2实现完整上传校验；此处只校验数量
        if (Array.isArray(value)) {
          if (value.length < field.min) {
            errors[field.key] = `${field.label}至少 ${field.min} 张`;
          } else if (value.length > field.max) {
            errors[field.key] = `${field.label}最多 ${field.max} 张`;
          }
        }
        break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/**
 * 组合 Prompt：用 formValues 插值 promptTemplate。
 * 支持两种语法：
 *   1. {{key}}         —— 简单替换（现有）
 *   2. {{#if key}}...{{/if}} —— 条件块，key 为 true 时渲染内容，否则删除
 *   3. {{ref_images}}      —— 图片素材说明（OPT-6: 让模型知道每张图的角色）
 *
 * OPT-6: 扩展条件块支持 checkbox 字段；注入图片角色信息。
 */

/** role → 中文角色描述 */
const roleDescriptions: Record<string, string> = {
  product: "商品图（呈现商品本身）",
  style: "风格/版式参考图",
  person: "参考人物图",
  brand: "品牌参考图",
};

/**
 * 根据 referenceImages 生成图片素材说明段。
 * 例："已上传图片素材：第1张为商品图（呈现商品本身），第2张为风格/版式参考图。"
 * 无参考图时返回空字符串。
 */
function buildRefImagesDesc(
  referenceImages?: { role: string }[],
): string {
  if (!referenceImages || referenceImages.length === 0) return "";
  // 与 provider 发图顺序一致：product 图在 multipart 中是 image 主图（首先发送），
  // 其他角色为 image[] 额外参考。prompt 编号需与此一致，否则模型混淆。
  const sorted = [...referenceImages].sort((a, b) => {
    const order: Record<string, number> = { product: 0, style: 1, person: 2, brand: 3 };
    const aOrder = order[a.role] ?? 9;
    const bOrder = order[b.role] ?? 9;
    return aOrder - bOrder;
  });
  const parts = sorted.map((r, i) => {
    const desc = roleDescriptions[r.role] ?? r.role;
    return `第${i + 1}张为${desc}`;
  });
  return `已上传图片素材：${parts.join("，")}。`;
}

export function composePrompt(
  template: string,
  values: FormValues,
  referenceImages?: { role: string }[],
): string {
  // 第一步：处理 {{#if key}}...{{/if}} 条件块
  const afterIfBlocks = template.replace(
    promptIfBlockRegex,
    (_match, key: string, inner: string) => {
      const value = values[key];
      // checkbox === true 渲染内容，其他（false/undefined/null）删除
      if (value === true) return inner;
      return "";
    },
  );

  // 第二步：注入图片素材说明（{{ref_images}}）
  const refImagesDesc = buildRefImagesDesc(referenceImages);
  const afterRefImages = afterIfBlocks.replace(
    /\{\{ref_images\}\}/g,
    refImagesDesc,
  );

  // 第三步：处理 {{key}} 简单替换
  return afterRefImages.replace(promptVarRegex, (match, key) => {
    if (typeof key !== "string" || !promptVarKeyRegex.test(key)) return match;
    const value = values[key];
    if (value === undefined || value === null) return "";
    if (value === true) return "是"; // checkbox 单独使用时输出中文
    if (value === false) return "否";
    if (Array.isArray(value)) return value.join("、");
    return String(value);
  });
}

/**
 * 一次生成多张图时，每张图的差异化指令（{{output_directive}}）。
 *
 * 为什么需要：此前 prompt 在批次层只算一次，N 个 Job 拿到逐字相同的字符串，
 * `outputRole` 虽然存进了快照却从未被拼进 prompt。结果是模型 N 次收到完全
 * 一样的指令、只有随机种子不同——详情页 6 张全做成信息最全的首屏，
 * 主图 5 张全做成吸睛图，`outputRoles` 里定义好的角色形同废纸。
 *
 * 现在按 role 生成一段专属指令，明确"这张只做什么、不要做什么"。
 */

/** 单张输出的定位信息，来自 Application.outputRoles。 */
export interface OutputRoleInfo {
  outputIndex: number;
  outputRole: string;
  title: string;
  description?: string;
}

/**
 * 各 role 的额外约束。`title`/`description` 说的是"做什么"，
 * 这里补的是"别做什么"——后者才是防止每张都退化成大杂烧的关键。
 *
 * ⚠️ 措辞必须是"怎么排版"，不能出现可以被当成文案抄上去的短语。
 * 实测：`selling_points` 原本写"以 3-5 条并列卖点为主体"，图上就印出了
 * "五大核心卖点"；`closing` 写"以品牌信任背书和购买理由收尾"，
 * 图上就印出了"品牌信任背书"。模型分不清这是指令还是要画的字，
 * 所以这里只描述版面结构，具体文案一律交给 copy_directive。
 *
 * ⚠️ 但"防泄漏"不等于"少写字"。第一版改写时用了"文字极简""文字极少"，
 * 结果首屏只剩商品名、收尾只剩一个 logo——被压掉的是真实卖点文案，
 * 而泄漏的其实是模块名，两件事互不相干。所以这里要正面说明
 * 各模块该写什么内容，禁模块名的活交给 NO_META_TEXT。
 */
const roleConstraints: Record<string, string> = {
  // 详情页 6 模块
  hero: "画面以商品主体为核心，配一句有力的主标题和一句副标题，点明商品定位与最核心的利益点",
  selling_points: "版面分成若干并列的小块，每块一个图标配一行短标题和一句说明，覆盖多个不同卖点",
  scene: "画面是真人在真实环境中使用商品的照片，可配一句点题的场景文案",
  material: "画面是商品材质与工艺的局部放大特写，配简短的材质名称与工艺说明",
  function: "用结构示意、尺寸标注、参数或效果对比图来说明功能，配必要的说明文字",
  closing: "画面呈现商品与品牌标识，配一句购买理由或服务承诺",
  // 主图 5 类型
  selling_point: "画面突出一个卖点，配一句短文案",
  compare: "画面用左右或前后对比的构图",
  mood: "画面营造节日或季节氛围，商品融入其中",
};

/**
 * 防止指令被当成文案画上去的兜底。
 *
 * 上面每条约束都已改成"描述版面"而非"描述内容"，但 title、description
 * 这些字段（如"卖点总览""收尾转化"）仍可能被模型直接印在图上，
 * 所以再加一句显式禁止。
 */
const NO_META_TEXT =
  "以上是排版要求，不是要写在图上的文字。" +
  "图中只能出现商品本身的真实文案，" +
  "禁止出现“卖点总览”“核心卖点”“品牌信任背书”“收尾转化”“场景代入”" +
  "“买家秀”“卖点海报”这类描述模块用途的词，也不要出现任何编号或序号";

/**
 * 买家秀多张时的人物一致性约束。
 *
 * 买家秀与海报的语义相反：海报每张讲不同卖点、应该有差异；
 * 买家秀是同一个人在不同角度/场景用同一件商品，人物必须是同一个。
 * 此前给无 outputRoles 的应用统一加了"与同组其它张明显区分开"，
 * 对海报是对的，对买家秀却是反效果——模型连人一起换了
 * （实测两张的美甲、袖口、服装都不同）。
 *
 * 易变特征必须逐项点名。只说"人物保持一致"模型只会保住
 * "大概是个年轻女性"这种粗粒度，美甲、配饰这些细节照样漂移。
 */
const BUYER_SHOW_CONSISTENCY =
  "同组各张是同一位人物、同一次拍摄的不同角度与瞬间：" +
  "相貌、发型、发色、肤色、体型、妆容、美甲、指甲颜色与长度、" +
  "配饰（戒指/手链/手表/耳饰）、服装款式与颜色必须严格保持一致，" +
  "只允许机位、取景范围、姿势和场景细节发生变化";

/** 有参考人物图时，明确要求照着它长——否则模型只把它当氛围参考。 */
const BUYER_SHOW_PERSON_REF =
  "已上传参考人物图时，人物的相貌、发型、肤色、体型、美甲与配饰均以该图为准，" +
  "严格还原其人物特征，不要自行发挥";

/**
 * 商品外观保真约束。
 *
 * 实测：详情页的"场景代入""功能证明"两张画出的商品不是用户上传的那件。
 * 这两张要表现"人在使用"和"结构剖析"，模型得在原图之外补画新角度，
 * 一旦开始补画就顺手把商品本身也重绘了。
 * 越是需要新角度的模块越要强调保真，所以这条对所有非买家秀模块都加。
 */
const PRODUCT_FIDELITY =
  "画面中的商品必须与商品图完全一致：外形轮廓、比例、材质纹理、" +
  "配色与图案细节都要严格还原，只允许改变拍摄角度、光线和所处环境，" +
  "不要重新设计商品，不要替换成外观相似的其它产品";

/**
 * 生成单张图的差异化指令。
 *
 * @param role      该张图的角色定义；无定义时返回空串
 * @param total     本批次总张数，用于告知模型"这是第 N 张、共 M 张"
 * @param opts      hasPersonRef: 是否上传了参考人物图（买家秀用）
 */
export function buildOutputDirective(
  role: OutputRoleInfo | undefined,
  total: number,
  opts?: { hasPersonRef?: boolean },
): string {
  if (!role) return "";

  // 买家秀（variant_* 是它的兜底 role 名）要的是人物一致、机位有别，
  // 与其它应用"内容要有区分"的诉求相反，单独走一套约束
  const isBuyerShow = role.outputRole.startsWith("variant_");

  const parts: string[] = [];
  // 让模型知道自己在整组里的位置与分工，是形成脉络（而非各画各的）的前提。
  // title 必须保留——去掉它六张就没有分工了。但要显式说明这是"用途"
  // 而非要画的标题，否则模型会把"卖点总览"这类词直接印在图上。
  if (total > 1) {
    parts.push(
      `本次共 ${total} 张成组输出，这是第 ${role.outputIndex} 张，用途是${role.title}`,
    );
  } else {
    parts.push(`本张用途：${role.title}`);
  }

  if (isBuyerShow) {
    if (total > 1) parts.push(BUYER_SHOW_CONSISTENCY);
    if (opts?.hasPersonRef) parts.push(BUYER_SHOW_PERSON_REF);
    parts.push(PRODUCT_FIDELITY);
    // 买家秀是"随手拍"风格，图上冒出"买家秀 1"这种字尤其违和
    parts.push(NO_META_TEXT);
    return parts.join("。") + "。";
  }

  // role.description 同样是给人看的说明（如"3-5 个核心卖点"），
  // 拼进 prompt 会被当成文案，所以不再注入——版面要求由 roleConstraints 表达
  const constraint = roleConstraints[role.outputRole];
  if (constraint) parts.push(constraint);

  parts.push(PRODUCT_FIDELITY);

  if (total > 1) {
    parts.push(
      "严格只做本张的定位，不要把其它张的内容和文案堆到这张上；" +
        "与同组其它张保持一致的视觉风格、配色与品牌调性",
    );
  }

  parts.push(NO_META_TEXT);

  return parts.join("。") + "。";
}

/**
 * 海报的卖点轮转指令（{{point_directive}}）。
 *
 * 海报应用的描述写着"每张使用不同卖点"、表单提示"每行一条卖点，海报按卖点轮转"，
 * 但这个轮转从来没被实现过——每张海报都拿到全部卖点。这里补上。
 *
 * 按行拆分后取模轮转：卖点条数少于张数时循环复用，多于张数时只用前 N 条。
 * 只对声明了 `usesPointRotation` 的应用生效（当前仅海报）。
 */
export function buildPointDirective(
  values: FormValues,
  role: OutputRoleInfo | undefined,
  total: number,
): string {
  const raw = values.selling_points;
  if (typeof raw !== "string" || raw.trim() === "") return "";

  const points = raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (points.length === 0) return "";

  // 只出 1 张、或该应用不走轮转（role 名无 point_ 前缀）时，给出全部卖点。
  // 海报模板已用本指令替代 {{selling_points}}，这里返回空串会让卖点彻底丢失。
  if (total <= 1 || !role || !role.outputRole.startsWith("point_")) {
    return `卖点：${points.join("；")}。`;
  }

  // 按行取模轮转：卖点少于张数时循环复用，多于张数时只用前 N 条
  const idx = (role.outputIndex - 1) % points.length;
  return `本张只围绕这一个卖点展开：${points[idx]}。不要把其它卖点写到这张上。`;
}

/**
 * 文案优先级三层逻辑（OPT-1）。
 * 包装函数：在调 composePrompt 之前，根据 copy/info/selling_points 判断走哪层，
 * 生成文案指令文本注入 values.copy_directive。
 *
 * 优先级 1：用户填了 copy → "图上写这段文案：{copy}"
 * 优先级 2：填了 info/selling_points → "基于卖点信息自动生成图片文案"
 * 优先级 3：都没填 → "不要在图上写任何文字"
 */
export function applyCopyPriority(values: FormValues): FormValues {
  const copy = values.copy;
  const info = values.info;
  const sellingPoints = values.selling_points;

  let directive: string;
  if (typeof copy === "string" && copy.trim() !== "") {
    directive = `图上写这段文案：${copy}`;
  } else if (
    (typeof info === "string" && info.trim() !== "") ||
    (typeof sellingPoints === "string" && sellingPoints.trim() !== "")
  ) {
    directive = "基于卖点信息自动生成图片文案";
  } else {
    directive = "不要在图上写任何文字";
  }

  return { ...values, copy_directive: directive };
}
