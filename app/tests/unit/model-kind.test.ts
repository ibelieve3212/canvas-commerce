import { describe, it, expect } from "vitest";
import { groupModels, looksLike, isLikelyWrongKind } from "@/lib/model-kind";

/**
 * 模型名分类。
 *
 * 关键约束：只排序不过滤。模型名没有可靠的判别规律，硬过滤一旦漏掉某个名字，
 * 用户就在下拉框里永远找不到自己要用的模型，而且不知道为什么。
 * 所以 likely + other 的并集必须等于输入集合。
 */
describe("groupModels", () => {
  it("不丢模型：分组并集等于输入", () => {
    const input = ["gpt-4o", "gpt-image-2", "some-custom-name", "flux-pro", "cmtaut99"];
    for (const kind of ["image", "chat"] as const) {
      const { likely, other } = groupModels(input, kind);
      expect([...likely, ...other].sort()).toEqual([...input].sort());
    }
  });

  it("生图：常见生图模型排进 likely", () => {
    const { likely } = groupModels(
      ["gpt-image-2", "dall-e-3", "flux-pro", "seedream-3", "gpt-4o"],
      "image",
    );
    expect(likely).toContain("gpt-image-2");
    expect(likely).toContain("dall-e-3");
    expect(likely).toContain("flux-pro");
    expect(likely).toContain("seedream-3");
    expect(likely).not.toContain("gpt-4o");
  });

  it("聊天：常见聊天模型排进 likely", () => {
    const { likely } = groupModels(
      ["gpt-4o", "claude-sonnet-4", "deepseek-chat", "gpt-image-2"],
      "chat",
    );
    expect(likely).toContain("gpt-4o");
    expect(likely).toContain("claude-sonnet-4");
    expect(likely).toContain("deepseek-chat");
    expect(likely).not.toContain("gpt-image-2");
  });

  it("同时命中两边的名字归为生图（gemini-2.5-flash-image）", () => {
    // 它带 gemini（聊天特征）也带 image（生图特征），实际是生图模型。
    // 判定顺序必须让生图优先，否则会被错分到聊天组。
    expect(looksLike("gemini-2.5-flash-image", "image")).toBe(true);
    expect(looksLike("gemini-2.5-flash-image", "chat")).toBe(false);
  });

  it("认不出的自定义名字归入 other，仍然可选", () => {
    // 中转站常自定义名称，如用户实际用的 cmtaut99
    const { likely, other } = groupModels(["cmtaut99"], "image");
    expect(likely).toEqual([]);
    expect(other).toEqual(["cmtaut99"]);
  });

  it("大小写不敏感", () => {
    expect(looksLike("GPT-Image-2", "image")).toBe(true);
    expect(looksLike("Claude-Sonnet-4", "chat")).toBe(true);
  });

  it("组内按名称排序", () => {
    const { likely } = groupModels(["gpt-image-3", "dall-e-3", "flux-pro"], "image");
    expect(likely).toEqual([...likely].sort());
  });

  it("空列表不报错", () => {
    expect(groupModels([], "chat")).toEqual({ likely: [], other: [] });
  });
});

describe("isLikelyWrongKind", () => {
  it("聊天栏选了生图模型 → 提示", () => {
    expect(isLikelyWrongKind("gpt-image-2", "chat")).toBe(true);
    expect(isLikelyWrongKind("dall-e-3", "chat")).toBe(true);
  });

  it("生图栏选了聊天模型 → 提示", () => {
    expect(isLikelyWrongKind("claude-sonnet-4", "image")).toBe(true);
  });

  it("选对了不提示", () => {
    expect(isLikelyWrongKind("gpt-4o", "chat")).toBe(false);
    expect(isLikelyWrongKind("gpt-image-2", "image")).toBe(false);
  });

  it("认不出的名字不打扰用户", () => {
    // 只在"明显属于另一边"时才提示，看不出规律的一律放行
    expect(isLikelyWrongKind("cmtaut99", "chat")).toBe(false);
    expect(isLikelyWrongKind("cmtaut99", "image")).toBe(false);
  });

  it("空值不提示", () => {
    expect(isLikelyWrongKind("", "chat")).toBe(false);
  });
});
