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
          title: app.kind === "POSTER" ? "单卖点营销海报" : `${app.name}实拍`,
          description: app.kind === "POSTER" ? "围绕分配到的单个卖点做画面主体" : "",
        }));

  const withCopy = applyCopyPriority(values);
  return roles.map((role) =>
    composePrompt(
      app.promptTemplate,
      {
        ...withCopy,
        output_directive: buildOutputDirective(role, roles.length, opts),
        point_directive: buildPointDirective(withCopy, role, roles.length),
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
    // 场景代入以真人使用的照片为主体，不是又一张带满文案的版式图
    expect(prompts[2]).toContain("真人在真实环境中使用商品");
    // 收尾转化落在品牌与购买理由上，不重复前面的卖点罗列
    expect(prompts[5]).toContain("购买理由或服务承诺");
    // 每张都要有"只做本张定位"的约束
    for (const p of prompts) expect(p).toContain("严格只做本张的定位");
  });

  it("防泄漏不等于压制文案：各模块仍要求写出该有的内容", () => {
    // 第一版改写时用了"文字极简""文字极少"，结果首屏只剩商品名、
    // 收尾只剩一个 logo——被压掉的是真实卖点文案，而泄漏的是模块名，
    // 两件事互不相干。约束应正面说明该写什么。
    const prompts = buildPrompts(detailPageApp, detailValues, 6);
    expect(prompts[0]).toContain("主标题和一句副标题");
    expect(prompts[1]).toContain("一行短标题和一句说明");
    expect(prompts[3]).toContain("材质名称与工艺说明");
    expect(prompts[4]).toContain("配必要的说明文字");
    for (const p of prompts) {
      expect(p).not.toContain("文字极简");
      expect(p).not.toContain("文字极少");
    }
  });

  describe("指令不能被当成文案画上去", () => {
    // 用户实测：详情页第 2 张图上印出了"五大核心卖点"、
    // 第 6 张印出了"品牌信任背书"——这些是我写给模型看的排版指令，
    // 模型分不清是指令还是要画的字，直接抄到图上了。
    // 实际电商详情页不会出现这种描述模块用途的词。
    it("海报与买家秀的 title 不带序号，也带防泄漏声明", () => {
      // 兜底生成的 title 原本是"卖点海报 1""香水 2"，会被拼进"用途是 XXX"。
      // 带序号的更容易被模型当成要画的标题印上去，而且买家秀是随手拍风格，
      // 图上冒出"买家秀 1"尤其违和。序号信息由"这是第 N 张"表达就够了。
      for (const app of [posterApp, buyerShowApp]) {
        const prompts = buildPrompts(app, { name: "香水", selling_points: "续航久\n防水" }, 2);
        for (const p of prompts) {
          expect(p).not.toMatch(/用途是.*[12]/);
          expect(p).toContain("以上是排版要求，不是要写在图上的文字");
          expect(p).toContain("也不要出现任何编号或序号");
        }
      }
    });

    it("role.description 不再注入 prompt（它是给人看的说明）", () => {
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      // detail-page.ts 里第 2 张的 description 是"3-5 个核心卖点"、
      // 第 6 张是"品牌信任 + 购买理由"。这类措辞被模型当成文案抄上去，
      // 图上就出现了"五大核心卖点""品牌信任背书"。
      // 注意不能断言 prompt 完全不含"核心卖点"——NO_META_TEXT 的禁止清单
      // 本身要列出这个词才能禁止它，那是有意为之。
      expect(prompts[1]).not.toContain("3-5 个核心卖点");
      expect(prompts[5]).not.toContain("品牌信任 + 购买理由");
      // 而排版要求（描述版面结构、不含可抄的短语）仍在
      expect(prompts[1]).toContain("版面分成若干并列的小块");
    });

    it("每张都显式声明排版要求不是要写的文字", () => {
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      for (const p of prompts) {
        expect(p).toContain("以上是排版要求，不是要写在图上的文字");
        // 把易泄漏的词直接列进禁止清单
        expect(p).toContain("卖点总览");
        expect(p).toContain("收尾转化");
      }
    });
  });

  describe("商品外观保真", () => {
    // 用户实测：详情页"场景代入""功能证明"两张画出的商品不是上传的那件。
    // 这两张要表现"人在使用"和"结构剖析"，模型得补画新角度，
    // 一旦开始补画就顺手把商品也重绘了。
    it("详情页每张都要求商品与商品图完全一致", () => {
      const prompts = buildPrompts(detailPageApp, detailValues, 6);
      for (const [i, p] of prompts.entries()) {
        expect(p, `第 ${i + 1} 张缺少保真约束`).toContain("与商品图完全一致");
        expect(p).toContain("只允许改变拍摄角度、光线和所处环境");
        expect(p).toContain("不要重新设计商品");
      }
    });

    it("买家秀也要求商品保真", () => {
      const prompts = buildPrompts(buyerShowApp, { name: "香水" }, 2);
      for (const p of prompts) expect(p).toContain("与商品图完全一致");
    });
  });

  it("主图选 3 张拿到吸睛/场景/卖点三种不同定位", () => {
    const prompts = buildPrompts(mainImageApp, { name: "音箱", category: "数码" }, 3);
    expect(new Set(prompts).size).toBe(3);
    expect(prompts[0]).toContain("吸睛主图");
    expect(prompts[1]).toContain("场景主图");
    expect(prompts[2]).toContain("卖点主图");
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
    expect(prompt).toContain("本张用途");
  });

  describe("同款参考版式（reference_layout）", () => {
    // 用户实测：勾选后只有第 1 张应用了参考图版式，第 2/3 张完全没体现。
    // 原措辞是"以参考图实际风格基调为准生成主图"，这被模型理解成
    // "整张照着参考图做"，与"这张要做真人使用场景"的角色约束直接对撞；
    // 加上它在 prompt 中部、角色约束在结尾，靠后的赢了。
    // 现在改为只继承视觉基调、画面内容仍按本张定位，两者不再互斥。
    const values = { name: "香水", category: "美妆/香水", reference_layout: true };

    it("勾选后每一张都带版式指令，不只第一张", () => {
      const prompts = buildPrompts(mainImageApp, values, 3);
      for (const [i, p] of prompts.entries()) {
        expect(p, `第 ${i + 1} 张缺少版式指令`).toContain("风格/版式参考图");
      }
    });

    it("版式指令与角色定位共存，不是二选一", () => {
      const prompts = buildPrompts(mainImageApp, values, 3);
      // 第 2 张：既要做场景图，又要沿用参考图色调
      expect(prompts[1]).toContain("场景主图");
      expect(prompts[1]).toContain("视觉基调");
      // 明确只继承基调，不复制参考图的主体——否则模型会把参考图的人和道具搬过来
      expect(prompts[1]).toContain("不要复制参考图里的具体主体");
      expect(prompts[1]).toContain("画面内容与构图仍按本张定位执行");
    });

    it("版式指令紧跟角色约束，不再隔一大段被压过", () => {
      const [prompt] = buildPrompts(mainImageApp, values, 3);
      // 位置关系是这次修复的关键：原来版式在中部、角色在结尾，
      // 模型更重视靠后的指令，于是版式被丢掉
      expect(prompt.indexOf("视觉基调")).toBeGreaterThan(prompt.indexOf("这是第 1 张"));
    });

    it("未勾选时不出现版式指令，风格选择正常保留", () => {
      const prompts = buildPrompts(mainImageApp, { name: "香水", category: "美妆/香水", style: "premium" }, 3);
      for (const p of prompts) {
        expect(p).not.toContain("视觉基调");
        expect(p).not.toContain("风格/版式参考图");
        expect(p).toContain("风格 premium");
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
      expect(prompt).toContain("本张用途");
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
