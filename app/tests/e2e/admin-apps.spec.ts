import { test, expect } from "@playwright/test";

/** GET /api/admin/applications 返回的行，这里只用到关心的三个字段 */
interface AdminAppRow {
  id: string;
  name: string;
  isPublished: boolean;
}

// 三个并行项目各自锁定不同的应用，避免同一行互相踩；
// 项目名不在表里时退回第 0 个（退化为现状，不会更糟）。
const PROJECT_SLOTS = ["desktop-1920", "desktop-1440", "mobile-390"];

test.describe("阶段6 管理员应用管理", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");
  });

  test("管理员可以上下架应用", async ({ page }, testInfo) => {
    await page.goto("/admin/applications");
    await expect(page.getByRole("heading", { name: "应用管理" })).toBeVisible({ timeout: 10000 });

    // 从 API 拿列表：锁定一个具名目标，行内断言、按 id 兜底还原。
    // 旧版点“列表第一个下架按钮”，并行时第一次点击的是 A、还原时第一个是 B，
    // 测试全绿也能把下架状态在应用间倒手，残骸留给后续所有套件。
    const res = await page.request.get("/api/admin/applications");
    expect(res.ok()).toBeTruthy();
    const apps = ((await res.json()) as { data: AdminAppRow[] }).data;
    expect(apps.length).toBeGreaterThan(0);
    const target = apps[Math.max(0, PROJECT_SLOTS.indexOf(testInfo.project.name)) % apps.length];
    const row = page.getByRole("listitem").filter({ hasText: target.name });

    try {
      if (target.isPublished) {
        await row.getByRole("button", { name: "下架" }).click();
        await expect(row.getByText("已下架", { exact: true })).toBeVisible({ timeout: 5000 });
        await row.getByRole("button", { name: "上架" }).click();
        await expect(row.getByText("已上架", { exact: true })).toBeVisible({ timeout: 5000 });
      } else {
        // 目标本来就是下架态（历史残留的脏数据）：上架回来即可，两个方向在上一分支已覆盖
        await row.getByRole("button", { name: "上架" }).click();
        await expect(row.getByText("已上架", { exact: true })).toBeVisible({ timeout: 5000 });
      }
    } finally {
      // 无论成败都把目标还原成上架（seed 基线），不再给 dev.db 留残骸
      await page.request
        .patch("/api/admin/applications", { data: [{ id: target.id, isPublished: true }] })
        .catch(() => {});
    }
  });

  test("普通用户不能访问应用管理 API", async ({ page }) => {
    // 先登出，用普通用户登录
    await page.goto("/login");
    await page.getByLabel("用户名").fill("user");
    await page.getByLabel("密码").fill("user123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    const res = await page.request.get("/api/admin/applications");
    expect(res.status()).toBe(403);
  });
});
