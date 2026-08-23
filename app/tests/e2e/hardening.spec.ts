import { test, expect } from "@playwright/test";

test.describe("阶段6 加固", () => {
  test("普通用户不能访问管理员路由和接口", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("user");
    await page.getByLabel("密码").fill("user123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    // 直接访问 admin 页面 → 被拦截
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/(apps|login)/);

    // admin API 返回 403
    const res = await page.request.get("/api/admin/users");
    expect(res.status()).toBe(403);

    // 清理策略接口同样拒绝普通用户（读和写都要拦）
    const readRes = await page.request.get("/api/admin/cleanup-policy");
    expect(readRes.status()).toBe(403);
    const writeRes = await page.request.post("/api/admin/cleanup-policy", {
      data: { retentionDays: 1, maxItemsPerUser: 10, preview: true },
    });
    expect(writeRes.status()).toBe(403);
  });

  test("普通用户看不到管理员的清理策略区块", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("user");
    await page.getByLabel("密码").fill("user123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/settings");
    await expect(page.getByText("配额概览")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: /存储与自动清理/ })).toBeHidden();
  });

  test("设置页显示配额概览和修改密码表单", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/settings");
    await expect(page.getByText("配额概览")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("今日剩余")).toBeVisible();
    await expect(page.getByText("总量剩余")).toBeVisible();
    await expect(page.getByRole("heading", { name: "修改密码" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Provider 配置" })).toBeVisible();
  });

  test("设置页显示 Provider 配置面板", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Provider 配置" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("Provider Base URL")).toBeVisible();
    await expect(page.getByLabel("生图模型")).toBeVisible();
    // 管理员应能看到全局默认配置
    await expect(page.getByRole("heading", { name: /管理员默认 Provider/ })).toBeVisible();
  });

  test("管理员设置页可见清理策略，且展示当前阈值与影响预估", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /存储与自动清理/ })).toBeVisible({ timeout: 10000 });

    // 阈值输入框应被当前生效值填充，而不是空的
    await expect(page.getByLabel("保留天数")).not.toHaveValue("");
    await expect(page.getByLabel("每用户数量上限")).not.toHaveValue("");

    // 收藏不豁免必须写在界面上——这是删除行为的关键预期
    await expect(page.getByText(/收藏图片不豁免/)).toBeVisible();
    await expect(page.getByText(/按当前设置待清理/).first()).toBeVisible();
  });

  test("清理策略接口拒绝越界阈值，且 preview 不写库", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    const before = await (await page.request.get("/api/admin/cleanup-policy")).json();

    // 下界校验：0 天 / 负数 / 上限过小都必须拒绝。
    // 这是防手滑的第一道闸——阈值填错一位就是不可恢复的批量删除。
    for (const bad of [
      { retentionDays: 0, maxItemsPerUser: 300 },
      { retentionDays: -5, maxItemsPerUser: 300 },
      { retentionDays: 30, maxItemsPerUser: 9 },
    ]) {
      const res = await page.request.post("/api/admin/cleanup-policy", {
        data: { ...bad, preview: true },
      });
      expect(res.status()).toBe(400);
    }

    // preview 只算不存：用一个明显不同的值预览，读回来应仍是旧值
    const previewRes = await page.request.post("/api/admin/cleanup-policy", {
      data: { retentionDays: 3650, maxItemsPerUser: 99999, preview: true },
    });
    expect(previewRes.status()).toBe(200);
    const previewJson = await previewRes.json();
    expect(previewJson.data.impact.assets.willDelete).toBe(0); // 阈值极大 → 不删任何东西

    const after = await (await page.request.get("/api/admin/cleanup-policy")).json();
    expect(after.data.retentionDays).toBe(before.data.retentionDays);
    expect(after.data.maxItemsPerUser).toBe(before.data.maxItemsPerUser);
  });
});
