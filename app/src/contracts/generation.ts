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
 * 一次生成最多能发多少张参考图（商品主图 + 附加参考）。
 *
 * provider 侧有硬上限，发超了会被静默截断；prompt 里的“第N张”编号
 * 必须与实际发图一致，否则模型会去找一张不存在的图。
 * 两边共用这个常量，不要各自写死。
 */
export const MAX_PROVIDER_REFERENCE_IMAGES = 4;

/**
 * role → 发图/编号顺序（prompt 里的“第N张”与 provider 实际发图顺序必须一致）。
 * 商品主图永远第 1 张，其余参考图按 style/person/brand 依次跟上。
 */
const refRoleOrder: Record<string, number> = {
  product: 0,
  style: 1,
  person: 2,
  brand: 3,
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
    const aOrder = refRoleOrder[a.role] ?? 9;
    const bOrder = refRoleOrder[b.role] ?? 9;
    return aOrder - bOrder;
  });
  const parts = sorted.slice(0, MAX_PROVIDER_REFERENCE_IMAGES).map((r, i) => {
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
  /**
   * 画面骨架短词（景别/机位/背景/主体构成）。
   *
   * 仅详情页在用。主图（main_ 前缀）已全面改用位次意图，不再写死骨架：
   * 实测写死骨架反而制造问题（氛围图的“多件成组散落”直接导致商品
   * 被裁到画面边缘，“道具与商品用途相关”则把橙子片肉桂棒引了进来）。
   */
  shot?: string;
}

/**
 * 各 role 的额外约束。`title`/`description` 说的是"做什么"，
 * 这里补的是"别做什么"——后者才是防止每张都退化成大杂烧的关键。
 */
/**
 * 主图位次的 role 前缀（如 main_scene）。
 *
 * 详情页也有 scene 这类同名 role，两者的约束诉求不同（详情页场景图
 * 要“配一句点题文案”，主图不需要），用前缀把两条路径彻底隔开。
 */
export const MAIN_IMAGE_ROLE_PREFIX = "main_";

/**
 * 各 role 的额外约束。`title`/`description` 说的是"做什么"，
 * 这里补的是"别做什么"——后者才是防止每张都退化成大杂烧的关键。
 *
 * 只服务详情页 6 个位次：主图（main_ 前缀）走 QQ1000 的轻量路径，
 * 不用这张表（见 buildOutputDirective 里的说明）。
 */
const roleConstraints: Record<string, string> = {
  // 详情页 6 模块
  hero: "只呈现商品定位与一句核心利益点，文字极简，不要罗列多条卖点",
  selling_points: "以 3-5 条并列卖点为主体，条目化排布，不要写成长段落",
  // 场景图原本要求"几乎不放文字"，实测出来是一张纯照片、零文案，
  // 而详情页的每一屏都该有信息承载。改为配点题文案，但仍不罗列卖点。
  scene: "以真实使用场景和人物情境为主体，配一句点题的场景文案传达使用感受，不要罗列卖点",
  material: "聚焦材质与工艺的局部放大特写，只标注与该细节相关的短说明",
  function: "以参数、结构图示或效果对比来证明功能，不要重复前面的卖点文案",
  closing: "以品牌信任背书和购买理由收尾，不要再堆商品卖点",
};

/**
 * 防止排版指令被当成文案画上去。
 *
 * 上面的措辞是给模型看的指令，但模型分不清"这是要求"还是"这是要画的字"：
 * "以 3-5 条并列卖点为主体" → 图上印出"五大核心卖点"；
 * "以品牌信任背书和购买理由收尾" → 图上印出"品牌信任背书"。
 * title（"卖点总览""收尾转化"）同理。
 *
 * 曾试过改写这些措辞来规避泄漏，但一并削掉了描述的信息量，
 * 出图文案反而变得干瘪（首屏只剩商品名、收尾只剩一个 logo）。
 * 所以措辞维持原样，只在末尾加一句显式声明——两件事分开处理。
 */
const NO_META_TEXT =
  "以上是排版与内容要求，不是要写在图上的文字。" +
  "图中的文案要围绕商品本身来写，" +
  "不要出现“卖点总览”“核心卖点”“品牌信任背书”“收尾转化”“场景代入”" +
  "这类描述模块用途的词，也不要出现模块编号";

/**
 * 商品外观保真约束。
 *
 * 实测：详情页的"场景代入""功能证明"两张画出的商品不是用户上传的那件。
 * 这两张要表现"人在使用"和"结构剖析"，模型得在原图之外补画新角度，
 * 一旦开始补画就顺手把商品本身也重绘了。
 */
const PRODUCT_FIDELITY =
  "画面中的商品必须与商品图完全一致：外形轮廓、比例、材质纹理、" +
  "配色与图案细节都要严格还原，不要重新设计商品，不要替换成外观相似的其它产品；" +
  "拍摄角度、光线、所处环境、背景和构图可以按本张定位与参考图要求改变，" +
  "但商品本身的外观、颜色、材质和 Logo/纹理位置不得改变";

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
 * 主图「带卖点文字」开关（QQ1000 include_main_selling_points 口径）。
 *
 * 返回两段要注入 prompt 的指令：
 * - selling_points_directive：本张要不要把卖点写进画面
 * - copy_directive_override：仅在“关了卖点且用户又没写文案”时非空，
 *   用于覆盖 applyCopyPriority 给出的“基于卖点信息自动生成图片文案”——
 *   否则“不直接生成卖点文字”与“自动生成文案”两句会同时进 prompt 打架。
 *
 * 注意：开关只管“卖点标签/卖点文案”；用户在“图片文案”里
 * 手写的文案仍然照写（用户明确要的字不该被开关静默吞掉）。
 */
export function buildSellingPointsContext(values: FormValues): {
  selling_points_directive: string;
  copy_directive_override?: string;
} {
  const info = String(values.info ?? "").trim();
  const userCopy = String(values.copy ?? "").trim();
  const include = values.include_selling_points !== false;

  if (include) {
    return {
      selling_points_directive: `主图需要呈现卖点，卖点/参数：${
        info || "根据商品图提炼真实卖点、材质、功能和购买理由"
      }`,
    };
  }
  return {
    selling_points_directive:
      "主图不直接生成卖点文字，只保留干净信息区或留白，不要绘制卖点标签",
    ...(userCopy ? {} : { copy_directive_override: "不要在图上写任何文字，只保留干净留白" }),
  };
}

/**
 * 生成单张图的差异化指令。
 *
 * @param role      该张图的角色定义；无定义时返回空串
 * @param total     本批次总张数，用于告知模型"这是第 N 张、共 M 张"
 * @param opts      hasPersonRef: 是否上传了参考人物图（买家秀用）
 *                  siblings: 本批次实际会生成的角色清单，仅有详页在用
 *                  （画面骨架避让；主图已改为靠位次意图天然区分）
 */
export function buildOutputDirective(
  role: OutputRoleInfo | undefined,
  total: number,
  opts?: { hasPersonRef?: boolean; siblings?: OutputRoleInfo[] },
): string {
  if (!role) return "";

  // 买家秀（variant_* 是它的兜底 role 名）要的是人物一致、机位有别，
  // 与其它应用"内容要有区分"的诉求相反，单独走一套约束
  const isBuyerShow = role.outputRole.startsWith("variant_");

  // ---- 主图（QQ1000 套图口径）：只给张次 + 一句位次意图 ----
  //
  // 对齐上游 E:/Workspace/qq1000-reference（listing-bundle）的 prompt 密度：
  // 上游每张只有“套图一键生成：当前只生成第 N 张主图，整套共有…”+ 一句位次意图，
  // 而上一版我们每张 701-1020 字，出图反而越差（对比图/氛围图为典型）。
  // 位次意图本身就互斥（白底/场景/促销/高端/细节/痛点/氛围/礼盒/平台），
  // 再叠骨架清单、兄弟图清单、多 SKU 规则只会稀释指令、互相打架。
  if (role.outputRole.startsWith(MAIN_IMAGE_ROLE_PREFIX)) {
    const lines: string[] = [];
    if (total > 1) {
      // 上游写法：“当前只生成第 N 张，整套共有 M 张”
      // 让模型知道自己在整组里的位置，不要一次画成套图拼贴
      lines.push(`本次共 ${total} 张成组输出，当前只生成第 ${role.outputIndex} 张。`);
    }
    if (role.description) lines.push(role.description);
    return lines.join("\n");
  }

  const parts: string[] = [];
  // 让模型知道自己在整组里的位置，是形成脉络（而非各画各的）的前提
  if (total > 1) {
    parts.push(
      `本次共 ${total} 张成组输出，这是第 ${role.outputIndex} 张：${role.title}`,
    );
  } else {
    parts.push(`本张定位：${role.title}`);
  }

  if (isBuyerShow) {
    if (total > 1) parts.push(BUYER_SHOW_CONSISTENCY);
    if (opts?.hasPersonRef) parts.push(BUYER_SHOW_PERSON_REF);
    // 买家秀分支 return 得早，保真与防泄漏要在这里单独补一份。
    // 它同样需要：商品得是用户上传的那件，而"买家秀 1"这类
    // 兜底 title 印在随手拍风格的图上尤其违和。
    parts.push(PRODUCT_FIDELITY);
    parts.push(NO_META_TEXT);
    return parts.join("。") + "。";
  }

  if (role.description) parts.push(role.description);

  const constraint = roleConstraints[role.outputRole];
  if (constraint) parts.push(constraint);

  if (total > 1) {
    // 同组骨架清单：模型每次只看到自己这一次的调用，不知道另外几张长什么样，
    // 只能凭角色名猜，5 个角色名在它眼里都是“电商主图” → 画出来雷同。
    // 把同组每张的骨架显式列出，它才知道该避开什么。
    const siblingShots = (opts?.siblings ?? [])
      .filter((s) => s.outputIndex !== role.outputIndex)
      .map((s) => `${s.outputIndex} ${s.title}${s.shot ? `＝${s.shot}` : ""}`)
      .join("、");
    if (siblingShots) {
      parts.push(
        `本组 ${total} 张的画面骨架已分别占用：${siblingShots}。` +
          `本张（第 ${role.outputIndex} 张）的画面骨架必须与上面每张都明显不同：` +
          `景别、机位、背景类型、主体数量与摆放方式中至少两项要换掉，` +
          `不能是同一张图换个角度或换个背景的版本`,
      );
    }
    parts.push(
      "严格只做本张的定位，不要把其它张的内容和文案堆到这张上；" +
        "与同组其它张保持同一品牌调性（配色体系、质感档次、字体与文案风格一致），" +
        "但画面骨架必须明显不同",
    );
    // 多 SKU 商品（上传了多个颜色/款式）时，每张都铺满全部款式会互相撞车
    // 对比图是例外：它要么并置不同款式做版本对比，要么并置本款与普通款，
    // 就是要“多个商品同框”。不豁免的话，这条会和对比图的指令互相打架。
    if (role.outputRole !== "compare") {
      parts.push(
        "商品图里若有多个款式或颜色，本张只呈现本张定位需要的那 1-2 个，" +
          "不要每次都把全部款式平铺成一片；本组各张尽量覆盖不同款式组合",
      );
    }
  }

  parts.push(PRODUCT_FIDELITY);
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
 * 文案来源的三层判定。
 *
 * - explicit：用户手写了文案，照原样写到图上
 * - derived：没写文案但给了卖点/商品信息，由模型自行提炼
 * - none：三者全空，prompt 会明确要求不写任何文字
 *
 * 抽出来是为了让前端能提前知道会落到哪一层——"none" 出的是纯无字图，
 * 用户容易误以为是生成失败，需要在提交时明确告知。
 */
export type CopySource = "explicit" | "derived" | "none";

export function classifyCopySource(values: FormValues): CopySource {
  const copy = values.copy;
  const info = values.info;
  const sellingPoints = values.selling_points;

  if (typeof copy === "string" && copy.trim() !== "") return "explicit";
  if (
    (typeof info === "string" && info.trim() !== "") ||
    (typeof sellingPoints === "string" && sellingPoints.trim() !== "")
  ) {
    return "derived";
  }
  return "none";
}

/**
 * 文案优先级三层逻辑（OPT-1）。
 * 包装函数：调 composePrompt 之前把判定结果写成指令文本，
 * 注入 values.copy_directive。
 */
export function applyCopyPriority(values: FormValues): FormValues {
  const source = classifyCopySource(values);

  let directive: string;
  if (source === "explicit") {
    directive = `图上写这段文案：${values.copy}`;
  } else if (source === "derived") {
    directive = "基于卖点信息自动生成图片文案";
  } else {
    directive = "不要在图上写任何文字";
  }

  return { ...values, copy_directive: directive };
}

/**
 * 滑条档位映射：声明了 levels 的滑条，把数值换成最近档位的指令短语。
 * 只影响 prompt（composePrompt 吃的是返回值）；inputSnapshot 仍存原始数值。
 * 未声明 levels 的滑条与其它字段原样透传，存量应用行为不变。
 */
export function applySliderLevels(
  formSchema: import("./application").FormSchema,
  values: FormValues,
): FormValues {
  const out: FormValues = { ...values };
  for (const field of formSchema) {
    if (field.type !== "slider" || !field.levels) continue;
    const first = field.levels[0];
    if (!first) continue;

    const raw = out[field.key];
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw))
          ? Number(raw)
          : field.defaultValue;
    const clamped = Math.min(field.max, Math.max(field.min, n));

    let best = first;
    let bestDist = Math.abs(clamped - best.value);
    for (const level of field.levels) {
      const dist = Math.abs(clamped - level.value);
      if (dist < bestDist) {
        best = level;
        bestDist = dist;
      }
    }
    out[field.key] = best.phrase;
  }
  return out;
}
