import { describe, it, expect } from "vitest";
import {
  FormFieldSchema,
  ApplicationSchema,
  fieldKeyRegex,
} from "@/contracts/application";
import { builtinApplications } from "@/server/applications/seed";

describe("FormField key regex", () => {
  it("允许小写字母、数字、下划线，首字符为字母", () => {
    expect(fieldKeyRegex.test("product")).toBe(true);
    expect(fieldKeyRegex.test("a_1")).toBe(true);
    expect(fieldKeyRegex.test("Product")).toBe(false);
    expect(fieldKeyRegex.test("1abc")).toBe(false);
    expect(fieldKeyRegex.test("a-b")).toBe(false);
  });
});

describe("builtin applications contract", () => {
  it("四个内置应用通过 ApplicationSchema 校验", () => {
    expect(builtinApplications).toHaveLength(4);
    for (const app of builtinApplications) {
      const result = ApplicationSchema.safeParse(app);
      expect(result.success, `${app.slug}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it("每个应用的所有字段 key 唯一且符合规则", () => {
    for (const app of builtinApplications) {
      const keys = app.formSchema.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      keys.forEach((k) => expect(fieldKeyRegex.test(k)).toBe(true));
    }
  });

  it("详情页固定输出 6 个角色，outputIndex 1-6", () => {
    const detail = builtinApplications.find((a) => a.slug === "detail-page")!;
    expect(detail.outputConfig).toEqual({ mode: "fixed", count: 6 });
    expect(detail.outputRoles).toHaveLength(6);
    expect(detail.outputRoles.map((r) => r.outputIndex)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("主图输出可选 1/3/5，定义 5 个角色", () => {
    const main = builtinApplications.find((a) => a.slug === "main-image")!;
    expect(main.outputConfig).toEqual({ mode: "selectable", options: [1, 3, 5] });
    expect(main.outputRoles).toHaveLength(5);
  });

  it("买家秀可选 1/2/4，海报可选 1/2/4/6", () => {
    const buyer = builtinApplications.find((a) => a.slug === "buyer-show")!;
    expect(buyer.outputConfig).toEqual({ mode: "selectable", options: [1, 2, 4] });
    const poster = builtinApplications.find((a) => a.slug === "poster")!;
    expect(poster.outputConfig).toEqual({ mode: "selectable", options: [1, 2, 4, 6] });
  });

  it("买家秀 lock_scale 字段有条件显示 showWhen", () => {
    const buyer = builtinApplications.find((a) => a.slug === "buyer-show")!;
    const lockScale = buyer.formSchema.find((f) => f.key === "lock_scale");
    expect(lockScale).toBeDefined();
    expect(lockScale!.type).toBe("checkbox");
    if (lockScale!.type === "checkbox") {
      expect(lockScale!.showWhen).toEqual({ field: "category", equals: "佩戴" });
    }
  });
});

describe("FormField discriminated union", () => {
  it("拒绝未知字段类型", () => {
    const bad = { type: "unknown", key: "x", label: "x" };
    expect(FormFieldSchema.safeParse(bad).success).toBe(false);
  });

  it("slider 字段含 min/max/step", () => {
    const ok = {
      type: "slider",
      key: "realism",
      label: "真实度",
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 45,
    };
    expect(FormFieldSchema.safeParse(ok).success).toBe(true);
  });
});
