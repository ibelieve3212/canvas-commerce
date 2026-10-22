/**
 * @vitest-environment node
 *
 * 多图脉络：验证一次生成多张时，每张的 prompt 真的不同且各有定位。
 *
 * 回归的 bug：prompt 曾在批次层只算一次，N 个 Job 拿到逐字相同的字符串，
 * outputRole 从未拼进 prompt——详情页 6 张全做成首屏、主图 5 张全做成吸睛图。
 */
import { describe, it, expect } from "vitest";
import {
  composePrompt,
  applyCopyPriority,
  buildOutputDirective,
  buildPointDirective,
  buildSellingPointsContext,
  type OutputRoleInfo,
} from "@/contracts/generation";
import { detailPageApp } from "@/server/applications/apps/detail-page";
import { mainImageApp } from "@/server/applications/apps/main-image";
import { posterApp } from "@/server/applications/apps/poster";
import { buyerShowApp } from "@/server/applications/apps/buyer-show";
import type { Application } from "@/contracts/application";

/** 复刻 service.ts createBatch 里的逐张 prompt 组装，确保测的是真实链路 */
function buildPrompts(
  app: Application,
  values: Record<string, unknown>,
  count: number,
  opts?: { hasPersonRef?: boolean },
) {
  const roles: OutputRoleInfo[] =
    app.outputRoles.length > 0
      ? app.outputRoles.slice(0, count)
      : Array.from({ length: count }, (_, i) => ({
          outputIndex: i + 1,
          outputRole: app.kind === "POSTER" ? `point_${i + 1}` : `variant_${i + 1}`,
          title: app.kind === "POSTER" ? `卖点海报 ${i + 1}` : `${app.name} ${i + 1}`,
          description: app.kind === "POSTER" ? "围绕分配到的单个卖点做画面主体" : "",
        }));

  // 与 service.ts createBatch 同步：主图模板吃 selling_points_directive，
  // 且「主图带卖点文字」开关会覆盖 applyCopyPriority 注入的 copy_directive
  const spCtx = buildSellingPointsContext(values);
  const usesSellingPointsDirective = app.promptTemplate.includes("{{selling_points_directive}}");
  const withCopy = usesSellingPointsDirective && spCtx.copy_directive_override
    ? { ...applyCopyPriority(values), copy_directive: spCtx.copy_directive_override }
    : applyCopyPriority(values);
  return roles.map((role) =>
    composePrompt(
      app.promptTemplate,
      {
        ...withCopy,
        output_directive: buildOutputDirective(role, roles.length, opts),
        point_directive: buildPointDirective(withCopy, role, roles.length),
        selling_points_directive: spCtx.selling_points_directive,
      },
      [],
    ),
  );
}

const detailValues = {
  name: "便携蓝牙音箱",
  category: "数码",
  selling_points: "续航 20 小时\nIPX7 防水\n低音增强",
};

describe("多图脉络", () => {
  it("详情页 6 张的 prompt 两两不同", () => {
    const prompts = buildPrompts(detailPageApp, detailValues, 6);
    expect(prompts).toHaveLength(6);
    expect(new Set(prompts).size).toBe(6);
  });

  it("详情页每张都带自己的模块定位，且知道自己是第几张", () => {
    const prompts = buildPrompts(detailPageApp, detailValues, 6);
    const titles = ["首屏主视觉", "卖点总览", "场景代入", "材质细节", "功能证明", "收尾转化"];
    titles.forEach((title, i) => {
      expect(prompts[i]).toContain(title);
      expect(prompts[i]).toContain(`第 ${i + 1} 张`);
      expect(prompts[i]).toContain("共 6 张");
    });
  });

  it("详情页非首屏的张次不再被要求做成首屏", () => {
    const prompts = buildPrompts(detailPageApp, detailValues, 6);
    // 场景代入那张要明确说"不要罗列卖点"，这是防止退化成大杂烧的关键约束
    expect(prompts[2]).toContain("不要罗列卖点");
    // 收尾那张不该再堆卖点
    expect(prompts[5]).toContain("不要再堆商品卖点");
    // 每张都要有"只做本张定位"的约束
    for (const p of prompts) expect(p).toContain("严格只做本张的定位");
  });

  it("主图选 3 张拿到高点击/白底/场景三种不同定位", () => {
    const prompts = buildPrompts(mainImageApp, { name: "音箱", category: "数码" }, 3);
    expect(new Set(prompts).size).toBe(3);
    // 主图走 QQ1000 轻量口径：只给张次 + 一句位次意图（description），
    // 不拼 title、不拼骨架清单
    expect(prompts[0]).toContain("高点击首图：主体大、卖点集中");
    expect(prompts[1]).toContain("白底质感主图：纯净白底");
    expect(prompts[2]).toContain("场景主图：把商品放入真实使用场景");
  });

  it("主图模板不再写死'吸睛'，否则会盖过其它张的定位", () => {
    // 修复前模板结尾写死"生成高点击率、有视觉冲击力的吸睛主图"，
    // 5 张全被要求做吸睛图
    expect(mainImageApp.promptTemplate).not.toContain("吸睛");
    expect(mainImageApp.promptTemplate).toContain("{{output_directive}}");
  });

  it("海报按卖点轮转：每张只讲一条卖点", () => {
    const prompts = buildPrompts(posterApp, { name: "音箱", selling_points: "续航 20 小时\nIPX7 防水" }, 4);
    expect(prompts[0]).toContain("续航 20 小时");
    expect(prompts[0]).not.toContain("IPX7 防水");
    expect(prompts[1]).toContain("IPX7 防水");
    // 卖点少于张数时循环复用
    expect(prompts[2]).toContain("续航 20 小时");
    expect(prompts[3]).toContain("IPX7 防水");
  });

  it("海报只出 1 张时给出全部卖点，不能因轮转丢失", () => {
    // 模板里 {{selling_points}} 已被 {{point_directive}} 取代，
    // 单张若返回空串会导致卖点彻底丢失
    const [prompt] = buildPrompts(posterApp, { name: "音箱", selling_points: "续航 20 小时\nIPX7 防水" }, 1);
    expect(prompt).toContain("续航 20 小时");
    expect(prompt).toContain("IPX7 防水");
  });

  it("单张生成不出现'第 N 张/共 M 张'的成组措辞", () => {
    const [prompt] = buildPrompts(mainImageApp, { name: "音箱", category: "数码" }, 1);
    expect(prompt).not.toContain("共 1 张");
    // 单张时仍要带位次意图，否则模型不知道这张要做什么
    expect(prompt).toContain("高点击首图：主体大");
  });

  describe("同款参考版式（reference_layout）", () => {
    // 用户实测：勾选后只有第 1 张应用了参考图版式，第 2/3 张完全没体现。
    // 原措辞是"以参考图实际风格基调为准生成主图"，这被模型理解成
    // "整张照着参考图做"，与"这张要做真人使用场景"的角色约束直接对撞；
    // 加上它在 prompt 中部、角色约束在结尾，靠后的赢了。
    // 现在改为只继承视觉基调、画面内容仍按本张定位，两者不再互斥。
    // 新字段 reference_rule（三档 select）取代旧的 reference_layout 勾选框，
    // 从 formSchema 取选项值，避免测试里硬编码长指令文本
    const ruleField = mainImageApp.formSchema.find((f) => f.key === "reference_rule");
    const RULE_STRICT =
      ruleField?.type === "select"
        ? (ruleField.options.find((o) => o.label === "严格复刻参考图版式")?.value ?? "")
        : "";
    const values = { name: "香水", category: "美妆/香水", reference_rule: RULE_STRICT };

    it("勾选后每一张都带版式指令，不只第一张", () => {
      const prompts = buildPrompts(mainImageApp, values, 3);
      for (const [i, p] of prompts.entries()) {
        expect(p, `第 ${i + 1} 张缺少版式指令`).toContain("风格/版式参考图");
      }
    });

    it("版式指令与角色定位共存，不是二选一", () => {
      const prompts = buildPrompts(mainImageApp, values, 3);
      // 第 2 张：既要做白底质感图，又要沿用参考图版式
      expect(prompts[1]).toContain("白底质感主图：纯净白底");
      expect(prompts[1]).toContain("视觉基调");
      // 明确只继承基调，不复制参考图的主体——否则模型会把参考图的人和道具搬过来
      expect(prompts[1]).toContain("参考图里的商品、人物、Logo、文字不能照搬为主体");
    });

    it("版式指令紧跟角色约束，不再隔一大段被压过", () => {
      const [prompt] = buildPrompts(mainImageApp, values, 3);
      // 位置关系是这次修复的关键：原来版式在中部、角色在结尾，
      // 模型更重视靠后的指令，于是版式被丢掉。
      // 主图走 QQ1000 轻量口径，位次意图在 {{output_directive}}，
      // 版式指令（{{reference_rule}}）必须排在它后面
      expect(prompt.indexOf("视觉基调")).toBeGreaterThan(prompt.indexOf("高点击首图：主体大"));
    });

    it("未选参考图用法时不出现版式指令，风格选择正常保留", () => {
      // style 的 value 是完整指令文本（composePrompt 只做简单替换）
      const styleValue = "高端质感：克制构图、低饱和配色、方向明确的高光与暗部、强调材质与做工细节";
      const prompts = buildPrompts(mainImageApp, { name: "香水", category: "美妆/香水", style: styleValue }, 3);
      for (const p of prompts) {
        expect(p).not.toContain("视觉基调");
        expect(p).not.toContain("风格/版式参考图");
        expect(p).toContain("高端质感：克制构图");
      }
    });

    it("详情页同样对每一张生效", () => {
      const prompts = buildPrompts(
        detailPageApp,
        { name: "音箱", category: "数码", selling_points: "续航久", reference_layout: true },
        6,
      );
      expect(prompts).toHaveLength(6);
      for (const [i, p] of prompts.entries()) {
        expect(p, `第 ${i + 1} 张缺少版式指令`).toContain("视觉基调");
      }
    });
  });

  describe("买家秀人物一致性", () => {
    // 用户实测：买家秀出 2 张，两张的美甲、袖口、服装都不一样。
    // 根因是给无 outputRoles 的应用统一加了"与同组其它张明显区分开"——
    // 对海报（每张讲不同卖点）是对的，对买家秀是反效果，模型连人一起换了。
    // 买家秀的语义是同一个人在不同角度用同一件商品，只该变机位和场景。
    const buyerValues = { name: "香水", category: "美妆/香水" };

    it("多张时要求人物严格一致，且逐项点名易变特征", () => {
      const prompts = buildPrompts(buyerShowApp, buyerValues, 2);
      for (const p of prompts) {
        expect(p).toContain("同一位人物");
        // 只说"人物一致"模型只会保住粗粒度，细节照样漂移，必须点名
        expect(p).toContain("美甲");
        expect(p).toContain("配饰");
        expect(p).toContain("服装款式与颜色");
        expect(p).toContain("只允许机位、取景范围、姿势和场景细节发生变化");
      }
    });

    it("不再要求买家秀'明显区分开'——那正是人物漂移的原因", () => {
      const prompts = buildPrompts(buyerShowApp, buyerValues, 2);
      for (const p of prompts) {
        expect(p).not.toContain("明显区分开");
      }
    });

    it("海报仍保留差异化诉求，不被买家秀的一致性约束波及", () => {
      const prompts = buildPrompts(posterApp, { name: "音箱", selling_points: "续航久\n防水" }, 2);
      for (const p of prompts) {
        expect(p).not.toContain("同一位人物");
      }
      // 海报各张仍围绕不同卖点
      expect(prompts[0]).toContain("续航久");
      expect(prompts[1]).toContain("防水");
    });

    it("单张买家秀不加成组一致性约束", () => {
      const [prompt] = buildPrompts(buyerShowApp, buyerValues, 1);
      expect(prompt).not.toContain("同一位人物");
      expect(prompt).toContain("本张定位");
    });

    it("传了参考人物图时，明确要求照着它还原而非当氛围参考", () => {
      const withRef = buildOutputDirective(
        { outputIndex: 1, outputRole: "variant_1", title: "买家秀 1" },
        2,
        { hasPersonRef: true },
      );
      expect(withRef).toContain("以该图为准");
      expect(withRef).toContain("不要自行发挥");

      // 没传人物图时不该出现这句
      const without = buildOutputDirective(
        { outputIndex: 1, outputRole: "variant_1", title: "买家秀 1" },
        2,
      );
      expect(without).not.toContain("以该图为准");
    });
  });

  describe("详情页：保真 + 防泄漏 + 场景图文案", () => {
    // 这三项是在"用户认可的原版措辞"基础上追加的，不动原有描述的信息量——
    // 曾试过改写措辞来防泄漏，结果连真实文案一起削掉了（首屏只剩商品名、
    // 收尾只剩一个 logo），用户明确要求退回原版再单独加。
    it("每张都要求商品与商品图完全一致", () => {
      // 实测"场景代入""功能证明"画出的商品不是上传的那件——
      // 这两张要补画新角度，一开始补画就顺手重绘了商品
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      for (const [i, p] of prompts.entries()) {
        expect(p, `第 ${i + 1} 张缺少保真约束`).toContain("与商品图完全一致");
        expect(p).toContain("不要重新设计商品");
      }
    });

    it("每张都声明排版要求不是要写的文字", () => {
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      for (const p of prompts) {
        expect(p).toContain("不是要写在图上的文字");
        // 易泄漏的词列进黑名单：实测图上印出过"五大核心卖点""品牌信任背书"
        expect(p).toContain("卖点总览");
        expect(p).toContain("品牌信任背书");
      }
    });

    it("原版措辞保持不变，不因防泄漏而削掉信息量", () => {
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      // 这些是用户认可那版的原话，改写它们会让出图文案变干瘪
      expect(prompts[1]).toContain("以 3-5 条并列卖点为主体");
      expect(prompts[5]).toContain("以品牌信任背书和购买理由收尾");
    });

    it("场景代入要配点题文案，不再是纯照片", () => {
      // 原措辞"几乎不放文字"，实测出来零文案，而详情页每屏都该有信息承载
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      expect(prompts[2]).toContain("配一句点题的场景文案");
      expect(prompts[2]).not.toContain("几乎不放文字");
      // 但仍不该罗列卖点——那是第 2 张的活
      expect(prompts[2]).toContain("不要罗列卖点");
    });

    it("主图同样开启保真：三张的商品外形不该各不相同", () => {
      // 实测主图 3 张的坐垫外形完全不同：吸睛图是光滑羽毛纹、
      // 场景图把 T 型结构画成了扁圆形、只有卖点图接近原图。
      const prompts = buildPrompts(mainImageApp, { name: "坐垫", category: "养生" }, 3);
      for (const [i, p] of prompts.entries()) {
        expect(p, `主图第 ${i + 1} 张缺少保真约束`).toContain("严格保留商品的外观、形状、颜色、材质");
      }
    });

    it("海报与买家秀同样带保真与防泄漏", () => {
      for (const app of [posterApp, buyerShowApp]) {
        const prompts = buildPrompts(app, { name: "音箱", selling_points: "续航久" }, 2);
        for (const p of prompts) {
          expect(p, `${app.slug} 缺少保真约束`).toContain("与商品图完全一致");
          expect(p, `${app.slug} 缺少防泄漏声明`).toContain("不是要写在图上的文字");
        }
      }
    });
  });

  it("所有模板的条件块闭合标签正确", () => {
    // main-image 曾写成 {{/if}（少一个花括号），条件块永不生效，
    // 且 "{{/if}" 会原样进 prompt 发给模型
    for (const app of [detailPageApp, mainImageApp, posterApp]) {
      const opens = (app.promptTemplate.match(/\{\{#if\s/g) ?? []).length;
      const closes = (app.promptTemplate.match(/\{\{\/if\}\}/g) ?? []).length;
      expect(closes, `${app.slug} 的 if 闭合标签数不匹配`).toBe(opens);
    }
  });

  it("渲染后不残留未替换的占位符", () => {
    const prompts = buildPrompts(detailPageApp, detailValues, 6);
    for (const p of prompts) {
      expect(p).not.toMatch(/\{\{/);
      expect(p).not.toContain("{{/if}");
    }
  });
});
