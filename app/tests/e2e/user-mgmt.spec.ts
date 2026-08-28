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

/**
 * 回归：新建用户后点"重置密码"，刚建的用户从列表里消失，刷新又回来。
 *
 * 根因不在后端。点开重置密码后页面上出现"一个文本框（搜索）+ 一个密码框"，
 * Chrome 判定为登录表单，把保存过的 admin 自动填进搜索框，
 * 于是新用户被前端过滤掉了。全程无请求、无报错，所以像凭空漂移。
 */
test.describe("用户管理列表的搜索框不被密码管理器劫持", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(ADMIN.username);
    await page.getByLabel("密码").fill(ADMIN.password);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");
    await page.goto("/admin/users");
  });

  test("搜索框声明为 search 且关闭自动填充", async ({ page }) => {
    const search = page.getByPlaceholder("搜索用户名或姓名");
    await expect(search).toHaveAttribute("type", "search");
    await expect(search).toHaveAttribute("autocomplete", "off");
    // name 里不能出现 user/login/email，那是密码管理器的判据
    const name = await search.getAttribute("name");
    expect(name).not.toMatch(/user|login|email/i);
  });

  test("重置密码框声明 new-password，不让浏览器回填旧凭据", async ({ page }) => {
    // 按用户名单元格精确匹配：hasText 是子串匹配，"user" 会同时命中 testuser 之类
    const otherRow = page
      .locator("tbody tr")
      .filter({ has: page.getByRole("cell", { name: USER.username, exact: true }) });
    await otherRow.getByRole("button", { name: "重置密码" }).click();
    await expect(otherRow.getByPlaceholder("新密码")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  test("搜索无结果时给出提示，而不是一张空表", async ({ page }) => {
    await page.getByPlaceholder("搜索用户名或姓名").fill("zzz-不存在的用户-zzz");
    await expect(page.getByText(/没有匹配.*的用户/)).toBeVisible();
  });

  test("管理员自己那一行指向设置页，不再是必定 409 的重置按钮", async ({ page }) => {
    const selfRow = page
      .locator("tbody tr")
      .filter({ has: page.getByRole("cell", { name: ADMIN.username, exact: true }) });
    await expect(selfRow.getByRole("link", { name: "改自己的密码请去设置页" })).toBeVisible();
    await expect(selfRow.getByRole("button", { name: "重置密码" })).toHaveCount(0);
  });
});
