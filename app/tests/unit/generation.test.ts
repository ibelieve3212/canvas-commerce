import { describe, it, expect } from "vitest";
import {
  validateFormValues,
  composePrompt,
  promptVarRegex,
} from "@/contracts/generation";
import type { FormSchema } from "@/contracts/application";
import { detailPageApp } from "@/server/applications/apps/detail-page";

describe("validateFormValues", () => {
  it("必填缺失返回错误", () => {
    const form: FormSchema = detailPageApp.formSchema;
    const result = validateFormValues(form, {});
    expect(result.ok).toBe(false);
    expect(result.errors.product).toContain("必填");
    expect(result.errors.name).toContain("必填");
  });

  it("文本超长报错", () => {
    const form: FormSchema = [
      { type: "text", key: "name", label: "商品名", required: true, placeholder: "", maxLength: 5, defaultValue: "", group: "x" },
    ];
    const result = validateFormValues(form, { name: "abcdefg" });
    expect(result.ok).toBe(false);
    expect(result.errors.name).toContain("最大长度");
  });

  it("select 选项无效报错", () => {
    const form: FormSchema = [
      {
        type: "select",
        key: "platform",
        label: "平台",
        required: false,
        defaultValue: "taobao",
        options: [{ label: "淘宝", value: "taobao" }],
        group: "x",
      },
    ];
    const result = validateFormValues(form, { platform: "invalid" });
    expect(result.ok).toBe(false);
    expect(result.errors.platform).toContain("选项无效");
  });

  it("multiselect 超项报错", () => {
    const form: FormSchema = [
      {
        type: "multiselect",
        key: "tags",
        label: "标签",
        required: false,
        options: [
          { label: "a", value: "a" },
          { label: "b", value: "b" },
        ],
        defaultValues: [],
        maxItems: 1,
        group: "x",
      },
    ];
    const result = validateFormValues(form, { tags: ["a", "b"] });
    expect(result.ok).toBe(false);
    expect(result.errors.tags).toContain("最多选");
  });

  it("slider 超界报错", () => {
    const form: FormSchema = [
      { type: "slider", key: "r", label: "真实度", required: false, min: 0, max: 100, step: 1, unit: "", defaultValue: 45, group: "x" },
    ];
    expect(validateFormValues(form, { r: 150 }).ok).toBe(false);
    expect(validateFormValues(form, { r: 50 }).ok).toBe(true);
  });

  it("可选空值通过", () => {
    const form: FormSchema = [
      { type: "text", key: "extra", label: "补充", required: false, placeholder: "", maxLength: 100, defaultValue: "", group: "x" },
    ];
    expect(validateFormValues(form, { extra: "" }).ok).toBe(true);
    expect(validateFormValues(form, {}).ok).toBe(true);
  });
});

describe("composePrompt", () => {
  it("替换 {{key}} 变量", () => {
    const template = "商品 {{name}}，类目 {{category}}";
    const result = composePrompt(template, { name: "音箱", category: "数码" });
    expect(result).toBe("商品 音箱，类目 数码");
  });

  it("数组值用顿号连接", () => {
    const result = composePrompt("卖点 {{points}}", { points: ["轻", "薄", "快"] });
    expect(result).toBe("卖点 轻、薄、快");
  });

  it("缺失变量替换为空", () => {
    const result = composePrompt("商品 {{name}}", {});
    expect(result).toBe("商品 ");
  });

  it("非法变量名不替换", () => {
    const result = composePrompt("{{Name}} {{1a}}", { Name: "x" });
    expect(result).toBe("{{Name}} {{1a}}");
  });

  it("promptVarRegex 匹配合法变量", () => {
    const matches = [..."a {{x}} b {{y_1}}".matchAll(promptVarRegex)];
    expect(matches.map((m) => m[1])).toEqual(["x", "y_1"]);
  });

  // OPT-6: {{#if key}} 条件块
  it("{{#if key}} 条件块: true 时渲染内容", () => {
    const template = "商品 {{name}}{{#if premium}}，高端{{/if}}";
    const result = composePrompt(template, { name: "音箱", premium: true });
    expect(result).toBe("商品 音箱，高端");
  });

  it("{{#if key}} 条件块: false 时删除内容", () => {
    const template = "商品 {{name}}{{#if premium}}，高端{{/if}}";
    const result = composePrompt(template, { name: "音箱", premium: false });
    expect(result).toBe("商品 音箱");
  });

  it("{{#if key}} 条件块: undefined 时删除内容", () => {
    const template = "商品 {{name}}{{#if premium}}，高端{{/if}}";
    const result = composePrompt(template, { name: "音箱" });
    expect(result).toBe("商品 音箱");
  });

  // OPT-6: {{ref_images}} 图片素材说明
  it("{{ref_images}} 无参考图时替换为空", () => {
    const template = "{{ref_images}}商品 {{name}}";
    const result = composePrompt(template, { name: "音箱" }, []);
    expect(result).toBe("商品 音箱");
  });

  it("{{ref_images}} 有参考图时注入角色说明", () => {
    const template = "{{ref_images}}商品 {{name}}";
    // 前端传入的顺序（style 在前、product 在后）
    // 但 prompt 输出时应与 provider 发图顺序一致（product 先）
    const result = composePrompt(template, { name: "音箱" }, [
      { role: "style" },
      { role: "product" },
    ]);
    expect(result).toBe(
      "已上传图片素材：第1张为商品图（呈现商品本身），第2张为风格/版式参考图。商品 音箱",
    );
  });

  it("{{ref_images}} 不传 referenceImages 时替换为空", () => {
    const template = "{{ref_images}}商品 {{name}}";
    const result = composePrompt(template, { name: "音箱" });
    expect(result).toBe("商品 音箱");
  });
});
