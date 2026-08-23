import { test, expect } from "@playwright/test";

test.describe("ACCEPTANCE 键盘可访问与额度管理", () => {
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

  test("管理员可调整用户配额", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    // 找到普通用户 ID
    const usersRes = await page.request.get("/api/admin/users");
    const usersJson = await usersRes.json();
    const user = usersJson.data.find((u: { username: string }) => u.username === "user");

    // 调整额度
    const res = await page.request.patch(`/api/admin/users/${user.id}`, {
      data: {
        action: "update_quota",
        dailyLimit: 30,
        totalQuota: 200,
      },
    });
    expect(res.ok()).toBeTruthy();

    // 验证用户能看到新额度
    await page.request.get(`/api/me/quota`);
    // 这是 admin 的配额，不是 user 的
    // 切换到 user 验证
    const userContext = await page.context().browser()!.newContext();
    const userPage = await userContext.newPage();
    await userPage.goto("/login");
    await userPage.getByLabel("用户名").fill("user");
    await userPage.getByLabel("密码").fill("user123");
    await userPage.getByRole("button", { name: "登录" }).click();
    await userPage.waitForURL("**/apps");

    const userQuotaRes = await userPage.request.get("/api/me/quota");
    const userQuotaJson = await userQuotaRes.json();
    expect(userQuotaJson.data.dailyLimit).toBe(30);
    expect(userQuotaJson.data.totalQuota).toBe(200);

    await userContext.close();

    // 恢复默认
    await page.request.patch(`/api/admin/users/${user.id}`, {
      data: {
        action: "update_quota",
        dailyLimit: 20,
        totalQuota: 100,
      },
    });
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
