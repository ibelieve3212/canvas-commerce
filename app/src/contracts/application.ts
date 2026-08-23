/**
 * Application 领域契约。
 * 定义 Application 实体、FormField 动态表单 Schema、内置应用分类。
 *
 * 规则（AGENTS.md）：
 * - 字段 key 只允许小写字母、数字和下划线
 * - Prompt 模板不执行任意代码，只允许受控变量插值
 * - 首期实现前四种应用；CUSTOM 预留但不实现创建流程
 */
import { z } from "zod";

export const ApplicationKindSchema = z.enum([
  "DETAIL_PAGE",
  "MAIN_IMAGE",
  "BUYER_SHOW",
  "POSTER",
  "CUSTOM",
]);
export type ApplicationKind = z.infer<typeof ApplicationKindSchema>;

export const ApplicationVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);
export type ApplicationVisibility = z.infer<typeof ApplicationVisibilitySchema>;

export const ApplicationCategorySchema = z.enum([
  "ALL",
  "DETAIL_POSTER",
  "SCENE_MODEL",
  "BATCH",
  "IMAGE",
  "MINE",
]);
export type ApplicationCategory = z.infer<typeof ApplicationCategorySchema>;

export const aspectRatios = [
  "1:1",
  "4:5",
  "3:4",
  "16:9",
  "9:16",
] as const;
export const AspectRatioSchema = z.enum(aspectRatios);
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

/* ---------- 认为 FormField 是单层、显式声明的可判别联合 ---------- */

export const fieldKeyRegex = /^[a-z][a-z0-9_]*$/;

/** 文本输入：有最大长度限制，用于后续提交校验和 Prompt 插值上限。 */
export const TextFieldSchema = z.object({
  type: z.literal("text"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  placeholder: z.string().optional().default(""),
  maxLength: z.number().int().min(1).max(500).default(200),
  defaultValue: z.string().default(""),
  group: z.string().optional(),
});

export const TextAreaFieldSchema = z.object({
  type: z.literal("textarea"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  placeholder: z.string().optional().default(""),
  maxLength: z.number().int().min(1).max(2000).default(1000),
  defaultValue: z.string().default(""),
  group: z.string().optional(),
});

export const SelectFieldSchema = z.object({
  type: z.literal("select"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  options: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
    }),
  ),
  defaultValue: z.string().default(""),
  group: z.string().optional(),
});

export const RadioFieldSchema = SelectFieldSchema.extend({
  type: z.literal("radio"),
});

export const MultiSelectFieldSchema = z.object({
  type: z.literal("multiselect"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  options: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
    }),
  ),
  defaultValues: z.array(z.string()).default([]),
  maxItems: z.number().int().min(1).max(20).default(5),
  group: z.string().optional(),
});

export const CheckboxFieldSchema = z.object({
  type: z.literal("checkbox"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  defaultValue: z.boolean().default(false),
  group: z.string().optional(),
  showWhen: z
    .object({
      field: z.string(),
      equals: z.string(),
    })
    .optional(),
});

export const SliderFieldSchema = z.object({
  type: z.literal("slider"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  min: z.number().int().default(0),
  max: z.number().int().default(100),
  step: z.number().int().min(1).default(1),
  unit: z.string().optional().default(""),
  defaultValue: z.number().int().default(0),
  group: z.string().optional(),
  /** 条件显示：当另一字段等于某值时才显示此字段。 */
  showWhen: z
    .object({
      field: z.string(),
      equals: z.string(),
    })
    .optional(),
});

export const ImageFieldSchema = z.object({
  type: z.literal("image"),
  key: z.string().regex(fieldKeyRegex),
  label: z.string(),
  required: z.boolean().default(false),
  min: z.number().int().min(0).default(1),
  max: z.number().int().min(1).max(8).default(6),
  roles: z
    .array(
      z.enum(["product", "style", "person", "brand"]),
    )
    .optional()
    .default([]),
  /** 是否允许选择过往参考图。 */
  allowLibrary: z.boolean().default(true),
  group: z.string().optional(),
});

export const FormFieldSchema = z.discriminatedUnion("type", [
  TextFieldSchema,
  TextAreaFieldSchema,
  SelectFieldSchema,
  RadioFieldSchema,
  MultiSelectFieldSchema,
  CheckboxFieldSchema,
  SliderFieldSchema,
  ImageFieldSchema,
]);
export type FormField = z.infer<typeof FormFieldSchema>;

/** 应用的表单 Schema = 一组有序 FormField。 */
export const FormSchemaSchema = z.array(FormFieldSchema);
export type FormSchema = z.infer<typeof FormSchemaSchema>;

/** 输出数量配置。详情页固定 6；主图 1/3/5；买家秀 1/2/4；海报 1/2/4/6。 */
export const OutputConfigSchema = z
  .discriminatedUnion("mode", [
    z.object({
      mode: z.literal("fixed"),
      count: z.number().int().min(1).max(6),
    }),
    z.object({
      mode: z.literal("selectable"),
      options: z.array(z.number().int().min(1).max(6)),
    }),
  ])
  .nullable();
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

/** 应用的输出角色定义。详情页 6 个角色；海报按卖点轮转。 */
export const OutputRoleSchema = z.object({
  outputIndex: z.number().int(),
  outputRole: z.string(),
  title: z.string(),
  description: z.string().optional().default(""),
});
export type OutputRole = z.infer<typeof OutputRoleSchema>;

/** 应用定义（内置 + 自定义通用表示）。 */
export const ApplicationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  kind: ApplicationKindSchema,
  visibility: ApplicationVisibilitySchema.default("PUBLIC"),
  category: ApplicationCategorySchema,
  iconUrl: z.string().optional(),
  emojiIcon: z.string().optional(),
  tagline: z.string()
    .max(80)
    .default("")
    .describe("单行用途说明"),
  tags: z.array(z.string()).default([]),
  outputConfig: OutputConfigSchema,
  outputRoles: z.array(OutputRoleSchema).default([]),
  formSchema: FormSchemaSchema.default([]),
  defaultAspectRatio: AspectRatioSchema.default("1:1"),
  /** Prompt 模板：变量插值用 {{fieldName}} 语法。 */
  promptTemplate: z.string().default(""),
  templateVersion: z.number().int().default(1),
  isPublished: z.boolean().default(true),
});
export type Application = z.infer<typeof ApplicationSchema>;

/** 列表查询参数。 */
export const ListApplicationsQuerySchema = z.object({
  q: z.string().trim().default(""),
  category: ApplicationCategorySchema.default("ALL"),
  favorites: z.boolean().optional(),
});
export type ListApplicationsQuery = z.infer<typeof ListApplicationsQuerySchema>;
