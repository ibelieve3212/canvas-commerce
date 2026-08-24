import { describe, it, expect } from "vitest";
import {
  sumWillDelete,
  planAssetCleanup,
  type PerUserCount,
  type AssetLite,
} from "@/server/settings/cleanup-policy";

/**
 * 清理影响预估的算法测试。
 *
 * 这个函数的结果会显示在管理员保存清理策略前的二次确认里，
 * 算错会让管理员在错误的预期下按下"确定"，而清理是物理删除、不可恢复。
 */

const u = (userId: string, count: number): PerUserCount => ({ userId, _count: { id: count } });

/** sumWillDelete 只服务无子树的实体（Upload）；资产走 planAssetCleanup。 */
describe("sumWillDelete（上传图，无子树）", () => {
  it("无数据时为 0", () => {
    expect(sumWillDelete([], [], 300)).toBe(0);
  });

  it("未超期未超额时不删", () => {
    expect(sumWillDelete([u("a", 100)], [], 300)).toBe(0);
  });

  it("只超额：删超出上限的部分", () => {
    expect(sumWillDelete([u("a", 512)], [], 300)).toBe(212);
  });

  it("只超期：删全部超期项", () => {
    expect(sumWillDelete([u("a", 100)], [u("a", 43)], 300)).toBe(43);
  });

  it("超期与超额叠加时不重复计数", () => {
    // 用户有 400 张，其中 50 张超期。
    // 先删 50 张超期 → 剩 350 → 超上限 300 的 50 张也删 → 共 100。
    // 若先算超额（400-300=100）再加超期 50，会得到 150，属重复计数。
    expect(sumWillDelete([u("a", 400)], [u("a", 50)], 300)).toBe(100);
  });

  it("超期数量已超过上限时，只按超期算", () => {
    // 350 张里 340 张超期 → 删 340 → 剩 10 张，未超上限 → 不再删
    expect(sumWillDelete([u("a", 350)], [u("a", 340)], 300)).toBe(340);
  });

  it("多用户各自独立计算，不共享额度", () => {
    const perUser = [u("a", 400), u("b", 50), u("c", 310)];
    const expired = [u("a", 20)];
    // a: 20 超期 + (380-300)=80 → 100
    // b: 50 张，无超期、未超额 → 0
    // c: 无超期，310-300 → 10
    expect(sumWillDelete(perUser, expired, 300)).toBe(110);
  });

  it("上限调小会显著放大删除量", () => {
    // 同一批数据在不同上限下的结果——这正是二次确认要展示给管理员的差异
    const perUser = [u("a", 512)];
    expect(sumWillDelete(perUser, [], 300)).toBe(212);
    expect(sumWillDelete(perUser, [], 100)).toBe(412);
    expect(sumWillDelete(perUser, [], 10)).toBe(502);
  });

  it("超期名单里的用户不在总量名单时忽略", () => {
    // 防御性：两次 groupBy 之间有并发删除，超期名单可能多出已消失的用户
    expect(sumWillDelete([u("a", 100)], [u("ghost", 999)], 300)).toBe(0);
  });
});

/**
 * 资产清理规划。
 *
 * 这个函数同时被 worker 执行和管理员预览调用，所以它算错不只是"数字显示错"，
 * 而是真的会多删或少删文件。旧实现执行时按"取 N 个最老的再各自展开子树"，
 * 实际删除量远超 N，而预览只报 N——管理员在错误预期下按下了确定。
 */
describe("planAssetCleanup", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date("2026-08-24T00:00:00Z").getTime();
  const cutoff = new Date(now - 30 * DAY);
  /** ageDays 天前创建的资产 */
  const a = (
    id: string,
    userId: string,
    ageDays: number,
    parentAssetId: string | null = null,
  ): AssetLite => ({ id, userId, parentAssetId, createdAt: new Date(now - ageDays * DAY) });

  const plan = (assets: AssetLite[], maxItemsPerUser: number) =>
    planAssetCleanup(assets, { cutoff, maxItemsPerUser });

  it("无数据时不删", () => {
    const r = plan([], 300);
    expect(r.doomed.size).toBe(0);
    expect(r.expiredCount).toBe(0);
    expect(r.excessCount).toBe(0);
  });

  it("未超期未超额时不删", () => {
    expect(plan([a("1", "u", 5), a("2", "u", 10)], 300).doomed.size).toBe(0);
  });

  it("超期的根资产连同微调子树一并删", () => {
    // 父 40 天前（超期），两个子图分别 3 天前和 1 天前（未超期）。
    // 父删了留着孤立子图没意义，整棵删。
    const r = plan([a("p", "u", 40), a("c1", "u", 3, "p"), a("c2", "u", 1, "c1")], 300);
    expect([...r.doomed].sort()).toEqual(["c1", "c2", "p"]);
    expect(r.expiredCount).toBe(3);
    expect(r.excessCount).toBe(0);
  });

  it("未超期的子图不会带走仍在保留期内的父图", () => {
    // 只有子图超期（父图更新）。父图不该被牵连。
    const r = plan([a("p", "u", 5), a("c", "u", 40, "p")], 300);
    expect([...r.doomed]).toEqual(["c"]);
  });

  it("超额时整棵子树算一个删除单位，且不重复计数", () => {
    // 上限 2。用户有两棵树：t1（父+1子=2 张，较老）、t2（父+1子=2 张，较新）。
    // 共 4 张 > 2 → 删最老的整棵 t1（2 张）→ 剩 2 张，已达上限，停。
    const r = plan(
      [a("t1", "u", 20), a("t1c", "u", 19, "t1"), a("t2", "u", 10), a("t2c", "u", 9, "t2")],
      2,
    );
    expect([...r.doomed].sort()).toEqual(["t1", "t1c"]);
    expect(r.expiredCount).toBe(0);
    expect(r.excessCount).toBe(2);
  });

  it("超额只从根资产下手，不会删出断枝", () => {
    // 上限 1，一棵 3 张的树。删中间节点会留下"父在子没了"的断枝，
    // 所以只能整棵删——即使删完（0 张）低于上限也不回头。
    const r = plan([a("p", "u", 20), a("c1", "u", 19, "p"), a("c2", "u", 18, "c1")], 1);
    expect(r.doomed.size).toBe(3);
    expect(r.excessCount).toBe(3);
  });

  it("超期与超额叠加时不重复计数", () => {
    // 上限 2。5 张全是独立根：两张超期（40/35 天）先删 → 剩 3 张 >
    // 2 → 再删最老的 1 张 → 共 3 张。
    const r = plan(
      [a("e1", "u", 40), a("e2", "u", 35), a("n1", "u", 20), a("n2", "u", 10), a("n3", "u", 5)],
      2,
    );
    expect(r.expiredCount).toBe(2);
    expect(r.excessCount).toBe(1);
    expect(r.doomed.size).toBe(3);
    // 超额删的是存活里最老的那张
    expect(r.doomed.has("n1")).toBe(true);
  });

  it("超期已把数量压到上限内时不再按超额删", () => {
    const r = plan([a("e1", "u", 40), a("e2", "u", 40), a("n", "u", 1)], 2);
    expect(r.expiredCount).toBe(2);
    expect(r.excessCount).toBe(0);
  });

  it("多用户各自独立结算，不共享额度", () => {
    const r = plan(
      [
        a("a1", "ua", 20), a("a2", "ua", 15), a("a3", "ua", 10), // ua 3 张，上限 2 → 删 1
        a("b1", "ub", 20),                                        // ub 1 张 → 不删
      ],
      2,
    );
    expect([...r.doomed]).toEqual(["a1"]);
    expect(r.excessCount).toBe(1);
  });

  it("预览与执行同源：doomed.size 即实际删除数", () => {
    // previewCleanupImpact 报 doomed.size，worker 用同一个 plan 去删，
    // 两者必然一致——这是本函数存在的全部意义。
    const assets = [a("p", "u", 40), a("c", "u", 2, "p"), a("x", "u", 1)];
    const r = plan(assets, 300);
    expect(r.doomed.size).toBe(r.expiredCount + r.excessCount);
  });
});
