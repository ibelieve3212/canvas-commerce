import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("阶段0 smoke", () => {
  test("根路径重定向到 /apps 并渲染工作台", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/apps/);
    await expect(page.getByRole("heading", { name: "应用中心" })).toBeVisible();
  });

  test("导航可切换到任务中心", async ({ page }) => {
    await page.goto("/apps");
    // 桌面侧栏文本“任务中心”；移动底栏“任务”且“更多”菜单内隐藏副本不可见
    const taskLink = page.getByRole("link", { name: "任务中心" }).or(
      page.getByRole("link", { name: "任务", exact: true }),
    );
    const visible = taskLink.filter({ visible: true }).first();
    await visible.click();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(page.getByRole("heading", { name: "任务中心" })).toBeVisible();
  });
});
