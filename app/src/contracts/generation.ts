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
 */
const roleConstraints: Record<string, string> = {
  // 详情页 6 模块
  hero: "只呈现商品定位与一句核心利益点，文字极简，不要罗列多条卖点",
  selling_points: "以 3-5 条并列卖点为主体，条目化排布，不要写成长段落",
  scene: "以真实使用场景和人物情境为主体，几乎不放文字，不要罗列卖点",
  material: "聚焦材质与工艺的局部放大特写，只标注与该细节相关的短说明",
  function: "以参数、结构图示或效果对比来证明功能，不要重复前面的卖点文案",
  closing: "以品牌信任背书和购买理由收尾，不要再堆商品卖点",
  // 主图 5 类型
  selling_point: "只突出一个最强卖点，一句短文案，不要罗列多条",
  compare: "以使用前后或与普通版的对比构图为主体",
  mood: "以节日/促销/季节氛围营造为主，商品融入氛围",
};

/**
 * 生成单张图的差异化指令。
 *
 * @param role      该张图的角色定义；无定义（如买家秀/海报未配 outputRoles）时返回空串
 * @param total     本批次总张数，用于告知模型"这是第 N 张、共 M 张"
 */
export function buildOutputDirective(
  role: OutputRoleInfo | undefined,
  total: number,
): string {
  if (!role) return "";

  const parts: string[] = [];
  // 让模型知道自己在整组里的位置，是形成脉络（而非各画各的）的前提
  if (total > 1) {
    parts.push(
      `本次共 ${total} 张成组输出，这是第 ${role.outputIndex} 张：${role.title}`,
    );
  } else {
    parts.push(`本张定位：${role.title}`);
  }
  if (role.description) parts.push(role.description);

  const constraint = roleConstraints[role.outputRole];
  if (constraint) parts.push(constraint);

  if (total > 1) {
    parts.push(
      "严格只做本张的定位，不要把其它张的内容和文案堆到这张上；" +
        "与同组其它张保持一致的视觉风格、配色与品牌调性",
    );
  }

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
