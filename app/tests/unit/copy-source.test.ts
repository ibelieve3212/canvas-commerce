/**
 * @vitest-environment node
 *
 * 文案来源判定。
 *
 * 背景：三个来源（copy / info / selling_points）全空时，prompt 里会写死
 * "不要在图上写任何文字"，出的是纯无字图。这是设计如此，但界面上毫无预告——
 * 用户会以为生成失败了又重跑一遍。前端要能提前判断会落到哪一层，才好提示。
 */
import { describe, it, expect } from "vitest";
import { classifyCopySource, applyCopyPriority } from "@/contracts/generation";
import { detailPageApp } from "@/server/applications/apps/detail-page";
import { mainImageApp } from "@/server/applications/apps/main-image";
import { posterApp } from "@/server/applications/apps/poster";
import { buyerShowApp } from "@/server/applications/apps/buyer-show";

describe("文案来源判定", () => {
  it("填了 copy 就照原样印，优先级最高", () => {
    expect(classifyCopySource({ copy: "限时特惠" })).toBe("explicit");
    // 卖点也填了也不影响：手写文案优先
    expect(classifyCopySource({ copy: "限时特惠", selling_points: "续航久" })).toBe(
      "explicit",
    );
    expect(applyCopyPriority({ copy: "限时特惠" }).copy_directive).toBe(
      "图上写这段文案：限时特惠",
    );
  });

  it("只填卖点或商品信息，由 AI 自行提炼", () => {
    expect(classifyCopySource({ selling_points: "续航 20 小时" })).toBe("derived");
    expect(classifyCopySource({ info: "IPX7 防水" })).toBe("derived");
    expect(applyCopyPriority({ info: "IPX7 防水" }).copy_directive).toBe(
      "基于卖点信息自动生成图片文案",
    );
  });

  it("三者全空判为 none，对应的指令是明确不写字", () => {
    expect(classifyCopySource({})).toBe("none");
    expect(classifyCopySource({ name: "音箱", category: "数码" })).toBe("none");
    expect(applyCopyPriority({}).copy_directive).toBe("不要在图上写任何文字");
  });

  it("纯空白字符不算填了内容", () => {
    // trim 后为空的输入不该被当成有效文案，否则出图是一片空白文字区
    expect(classifyCopySource({ copy: "   " })).toBe("none");
    expect(classifyCopySource({ copy: "\n\t " })).toBe("none");
    expect(classifyCopySource({ copy: "  ", selling_points: "  " })).toBe("none");
    // copy 是空白但卖点有内容时，降级到 derived 而不是 explicit——
    // 否则 prompt 会变成"图上写这段文案：   "
    expect(classifyCopySource({ copy: "  ", selling_points: "续航久" })).toBe("derived");
  });

  it("非字符串类型不参与判定", () => {
    expect(classifyCopySource({ copy: 123 })).toBe("none");
    expect(classifyCopySource({ selling_points: ["a", "b"] })).toBe("none");
    expect(classifyCopySource({ copy: null, info: undefined })).toBe("none");
  });
});

describe("哪些应用需要弹无文案确认", () => {
  /** 与 generator-client 的判断一致：模板真的吃 copy_directive 才有意义 */
  const usesCopyDirective = (t: string) => t.includes("{{copy_directive}}");

  it("详情页、主图、海报的模板都吃 copy_directive", () => {
    for (const app of [detailPageApp, mainImageApp, posterApp]) {
      expect(usesCopyDirective(app.promptTemplate), `${app.slug}`).toBe(true);
    }
  });

  it("买家秀不吃 copy_directive，不该为它弹确认", () => {
    // 买家秀是"真人随手拍"，本来就不该有营销文案，也没有 copy 字段
    expect(usesCopyDirective(buyerShowApp.promptTemplate)).toBe(false);
    expect(buyerShowApp.formSchema.some((f) => f.key === "copy")).toBe(false);
  });

  it("详情页与海报的卖点是必填，正常填完不会触发确认", () => {
    // 必填字段挡在前面，这两个应用只有绕过校验才可能落到 none
    for (const app of [detailPageApp, posterApp]) {
      const sp = app.formSchema.find((f) => f.key === "selling_points");
      expect(sp?.required, `${app.slug} 的卖点应为必填`).toBe(true);
    }
  });

  it("主图的商品信息是选填，是确认弹窗的主要适用场景", () => {
    // 主图只强制商品名和类目，两个卖点类字段都可留空 → 会出无字图
    const info = mainImageApp.formSchema.find((f) => f.key === "info");
    expect(info?.required).toBe(false);
    const onlyRequired: Record<string, unknown> = { name: "音箱", category: "数码" };
    expect(classifyCopySource(onlyRequired)).toBe("none");
  });

  it("提示里点名的字段在各应用中真实存在", () => {
    // 文案写「商品卖点」/「商品信息」，说错名字用户会去找不存在的输入框
    const labelOf = (app: typeof detailPageApp, key: string) =>
      app.formSchema.find((f) => f.key === key)?.label;
    expect(labelOf(detailPageApp, "selling_points")).toBe("商品卖点");
    expect(labelOf(posterApp, "selling_points")).toBe("核心卖点（每行一条）");
    expect(labelOf(mainImageApp, "info")).toBe("商品信息");
    for (const app of [detailPageApp, mainImageApp, posterApp]) {
      expect(labelOf(app, "copy"), `${app.slug} 应有图片文案字段`).toBe("图片文案");
    }
  });
});
