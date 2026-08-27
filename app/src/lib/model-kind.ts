/**
 * 模型名分类：把上游 /v1/models 的扁平列表分成"可能是生图"和"可能是聊天"。
 *
 * 为什么只排序不过滤：模型名没有可靠的判别规律。
 * flux / sd3 / seedream / nano-banana / gemini-2.5-flash-image 都是生图模型，
 * 名字里却不都带 image；gpt-4o 不带 image 但能看图；中转站还常自定义名称。
 * 硬过滤一旦漏掉某个名字，用户就在下拉框里永远找不到自己要用的模型，
 * 而且不知道为什么——这比多出几个无关选项糟糕得多。
 *
 * 所以策略是：疑似匹配的排前面，其余归入"其他"仍然可选；
 * 选了明显不匹配的再给一行浅色提示，不阻止保存。
 */

/** 生图模型的名称特征。命中任一即视为疑似生图。 */
const IMAGE_HINTS = [
  "image",
  "dall-e",
  "dalle",
  "flux",
  "sd3",
  "sdxl",
  "stable-diffusion",
  "seedream",
  "seededit",
  "midjourney",
  "kolors",
  "wanx",
  "hunyuan-image",
  "nano-banana",
  "recraft",
  "ideogram",
  "qwen-image",
];

/** 聊天模型的名称特征。 */
const CHAT_HINTS = [
  "gpt-3",
  "gpt-4",
  "gpt-5",
  "o1",
  "o3",
  "o4",
  "chatgpt",
  "claude",
  "gemini",
  "deepseek",
  "qwen",
  "glm",
  "moonshot",
  "kimi",
  "yi-",
  "llama",
  "mistral",
  "grok",
  "hunyuan",
  "ernie",
  "spark",
  "doubao",
  "minimax",
  "step-",
  "abab",
];

function matchesAny(name: string, hints: string[]): boolean {
  const lower = name.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

export type ModelKind = "image" | "chat";

/** 该模型名是否疑似属于指定用途。 */
export function looksLike(name: string, kind: ModelKind): boolean {
  const isImage = matchesAny(name, IMAGE_HINTS);
  if (kind === "image") return isImage;
  // 聊天：命中聊天特征且不带生图特征。
  // 顺序要紧——gemini-2.5-flash-image 同时命中两边，它是生图模型。
  return !isImage && matchesAny(name, CHAT_HINTS);
}

export interface GroupedModels {
  /** 疑似匹配当前用途的，排在前面 */
  likely: string[];
  /** 其余的，仍可选 */
  other: string[];
}

/**
 * 按用途把模型列表分成两组。两组内各自按名称排序。
 * 不丢弃任何模型——likely 与 other 的并集等于输入集合。
 */
export function groupModels(models: string[], kind: ModelKind): GroupedModels {
  const likely: string[] = [];
  const other: string[] = [];
  for (const m of models) {
    (looksLike(m, kind) ? likely : other).push(m);
  }
  return {
    likely: likely.sort(),
    other: other.sort(),
  };
}

/**
 * 当前选中的模型是否与用途明显不符（用于给浅色提示）。
 * 只在"明显属于另一边"时才为真——名字看不出规律的返回 false，不打扰用户。
 */
export function isLikelyWrongKind(model: string, kind: ModelKind): boolean {
  if (!model) return false;
  const otherKind: ModelKind = kind === "image" ? "chat" : "image";
  return !looksLike(model, kind) && looksLike(model, otherKind);
}
