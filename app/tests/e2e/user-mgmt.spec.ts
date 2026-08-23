import { test, expect } from "@playwright/test";

/**
 * ACCEPTANCE.md 必备场景 2 & 13：
 * - 管理员停用用户、重置密码，验证停用/重置后会话失效
 * - 两用户间 Upload/Batch/Asset 越权均返回 403/404
 */

const ADMIN = { username: "admin", password: "admin123" };
const USER = { username: "user", password: "user123" };

test.describe("ACCEPTANCE 用户管理与越权", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(ADMIN.username);
    await page.getByLabel("密码").fill(ADMIN.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");
  });

  test("管理员重置用户密码后用户原会话失效", async ({ page, browser }) => {
    // 1. 用户登录获取会话
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await userPage.goto("/login");
    await userPage.getByLabel("用户名").fill(USER.username);
    await userPage.getByLabel("密码").fill(USER.password);
    await userPage.getByRole("button", { name: "登录" }).click();
    await userPage.waitForURL("**/apps");

    // 确认用户已登录
    const meRes = await userPage.request.get("/api/me");
    expect(meRes.status()).toBe(200);

    // 2. 管理员重置用户密码
    // 先找到用户 ID
    const usersRes = await page.request.get("/api/admin/users");
    const usersJson = await usersRes.json();
    const user = usersJson.data.find((u: { username: string }) => u.username === USER.username);
    expect(user).toBeTruthy();

    const resetRes = await page.request.patch(`/api/admin/users/${user.id}`, {
      data: { action: "reset_password", password: "newpass123" },
    });
    expect(resetRes.ok()).toBeTruthy();

    // 3. 用户原会话应失效
    const meRes2 = await userPage.request.get("/api/me");
    expect([401, 403]).toContain(meRes2.status());

    await userContext.close();

    // 4. 恢复密码
    await page.request.patch(`/api/admin/users/${user.id}`, {
      data: { action: "reset_password", password: USER.password },
    });
  });

  test("管理员停用用户后用户会话立即失效", async ({ page, browser }) => {
    // 1. 用户登录
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await userPage.goto("/login");
    await userPage.getByLabel("用户名").fill(USER.username);
    await userPage.getByLabel("密码").fill(USER.password);
    await userPage.getByRole("button", { name: "登录" }).click();
    await userPage.waitForURL("**/apps");

    // 2. 管理员停用用户
    const usersRes = await page.request.get("/api/admin/users");
    const usersJson = await usersRes.json();
    const user = usersJson.data.find((u: { username: string }) => u.username === USER.username);

    await page.request.patch(`/api/admin/users/${user.id}`, {
      data: { action: "toggle_status", status: "SUSPENDED" },
    });

    // 3. 用户会话应失效
    const meRes = await userPage.request.get("/api/me");
    expect([401, 403]).toContain(meRes.status());

    // 4. 恢复用户
    await page.request.patch(`/api/admin/users/${user.id}`, {
      data: { action: "toggle_status", status: "ACTIVE" },
    });

    await userContext.close();
  });

  test("两用户间资产越权返回 403/404", async ({ page, browser }) => {
    // 1. admin 获取自己的资产列表
    const assetsRes = await page.request.get("/api/assets?pageSize=1");
    const assetsJson = await assetsRes.json();
    const adminAsset = assetsJson.data?.items?.[0];
    expect(adminAsset).toBeTruthy();

    // 2. admin 获取自己的批次列表
    const batchesRes = await page.request.get("/api/batches?pageSize=1");
    const batchesJson = await batchesRes.json();
    const adminBatch = batchesJson.data?.items?.[0];
    expect(adminBatch).toBeTruthy();

    // 3. user 登录
    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await userPage.goto("/login");
    await userPage.getByLabel("用户名").fill(USER.username);
    await userPage.getByLabel("密码").fill(USER.password);
    await userPage.getByRole("button", { name: "登录" }).click();
    await userPage.waitForURL("**/apps");

    // 4. user 尝试访问 admin 的 batch → 404/403
    const batchRes = await userPage.request.get(`/api/batches/${adminBatch.id}`);
    expect([403, 404]).toContain(batchRes.status());

    // 5. user 尝试删除 admin 的 asset → 404/403
    const assetRes = await userPage.request.delete(`/api/assets/${adminAsset.id}`);
    expect([403, 404]).toContain(assetRes.status());

    // 6. user 尝试下载 admin 的图片 → 403
    const imgRes = await userPage.request.get(`/api/storage/${encodeURIComponent(adminAsset.objectKey)}`);
    expect([403, 404]).toContain(imgRes.status());

    await userContext.close();
  });
});
