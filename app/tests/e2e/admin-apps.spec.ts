import { test, expect } from "@playwright/test";

test.describe("阶段6 管理员应用管理", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");
  });

  test("管理员可以上下架应用", async ({ page }) => {
    await page.goto("/admin/applications");
    await expect(page.getByRole("heading", { name: "应用管理" })).toBeVisible({ timeout: 10000 });

    // 确保至少有 4 个应用
    const downButtons = page.getByRole("button", { name: /下架|上架/ });
    await expect(downButtons.first()).toBeVisible();

    // 点击第一个"下架"按钮
    const firstDownBtn = page.getByRole("button", { name: "下架" }).first();
    await firstDownBtn.click();
    await expect(page.getByText("已下架").first()).toBeVisible({ timeout: 5000 });

    // 重新上架
    const firstUpBtn = page.getByRole("button", { name: "上架" }).first();
    await firstUpBtn.click();
    await expect(page.getByText("已上架").first()).toBeVisible({ timeout: 5000 });
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
