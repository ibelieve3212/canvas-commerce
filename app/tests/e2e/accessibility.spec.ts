import { test, expect } from "@playwright/test";

test.describe("ACCEPTANCE 键盘可访问", () => {
  test("登录页可通过键盘完成", async ({ page }) => {
    await page.goto("/login");

    // Tab 到用户名输入框
    await page.keyboard.press("Tab");
    await page.keyboard.type("admin");

    // Tab 到密码输入框
    await page.keyboard.press("Tab");
    await page.keyboard.type("admin123");

    // Tab 到登录按钮并回车
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");

    await page.waitForURL("**/apps");
    expect(page.url()).toContain("/apps");
  });

  test("应用中心可通过键盘导航", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    // Tab 遍历，不应报错
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    // 页面无崩溃即可
    await expect(page).toHaveURL(/\/apps/);
  });
});
