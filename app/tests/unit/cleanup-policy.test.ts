import { describe, it, expect } from "vitest";
import { sumWillDelete, type PerUserCount } from "@/server/settings/cleanup-policy";

/**
 * 清理影响预估的算法测试。
 *
 * 这个函数的结果会显示在管理员保存清理策略前的二次确认里，
 * 算错会让管理员在错误的预期下按下"确定"，而清理是物理删除、不可恢复。
 */

const u = (userId: string, count: number): PerUserCount => ({ userId, _count: { id: count } });

describe("sumWillDelete", () => {
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
