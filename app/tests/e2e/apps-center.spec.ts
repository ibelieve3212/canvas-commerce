import { test, expect } from "@playwright/test";

// 认证
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("阶段2 应用中心", () => {
  test("展示四个内置应用并支持搜索", async ({ page }) => {
    await page.goto("/apps");
    await expect(page.locator("h1", { hasText: "应用中心" })).toBeVisible();

    // 四个内置应用卡可见（卡片本身是链接）
    await expect(page.getByRole("link", { name: /商品主图/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /AI 详情页/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /买家秀/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /营销海报/ }).first()).toBeVisible();

    // 搜索过滤
    await page.getByLabel("搜索应用").fill("买家");
    await expect(page.getByRole("link", { name: /买家秀/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /商品主图/ })).toHaveCount(0);
  });

  test("分类 Tab 切换并同步 URL", async ({ page }) => {
    await page.goto("/apps");
    await page.getByRole("button", { name: "场景与模特" }).click();
    await expect(page).toHaveURL(/category=SCENE_MODEL/);
    await expect(page.getByRole("link", { name: /买家秀/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /商品主图/ })).toHaveCount(0);
  });

  test("空态有清除筛选", async ({ page }) => {
    await page.goto("/apps?q=zzzznotexist");
    await expect(page.getByText("没有匹配的应用")).toBeVisible();
    await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();
  });

  test("收藏刷新后保持", async ({ page }) => {
    await page.goto("/apps");
    // 点击第一张卡（商品主图）的收藏按钮（精确匹配，避免误点“仅看收藏”）。
    // 水合完成前的点击会被 React 吞掉且不回放，重试到按钮翻转为“取消收藏”即写入成功。
    const favBtn = page.getByRole("button", { name: "收藏", exact: true }).first();
    await expect(async () => {
      await favBtn.click();
      await expect(
        page.getByRole("button", { name: "取消收藏", exact: true }).first(),
      ).toBeVisible({ timeout: 1000 });
    }).toPass();
    // 刷新
    await page.reload();
    // 等水合完成再点“仅看收藏”：收藏态要在客户端从 localStorage 恢复后才会显示
    // （按钮变回“取消收藏”就是信号），否则点击落在水合前，事件未绑定、URL 不变。
    await expect(
      page.getByRole("button", { name: "取消收藏", exact: true }).first(),
    ).toBeVisible();
    // 仅看收藏
    await page.getByRole("button", { name: "仅看收藏" }).click();
    await expect(page).toHaveURL(/favorites=1/);
    // 收藏后只剩 1 个应用
    await expect(page.getByRole("link", { name: /商品主图/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /买家秀/ })).toHaveCount(0);
  });

  test("从应用中心进入生成器", async ({ page }) => {
    await page.goto("/apps");
    // 等七张卡都渲染完再点（4 个生成应用 + 3 个图片处理工具）。
    // 收藏状态是客户端二次拉取的，列表会重渲染一次，
    // 点在旧 DOM 节点上会丢失导航（上一版这里偶发失败：URL 停在 /apps）。
    await expect(page.getByRole("link", { name: /进入 / })).toHaveCount(7);
    const link = page.getByRole("link", { name: /AI 详情页/ }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/apps\/detail-page/);
    // 页面标题（h1）
    await expect(page.locator("h1", { hasText: "AI 详情页" })).toBeVisible();
  });
});
