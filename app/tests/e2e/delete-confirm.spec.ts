import { test, expect } from "@playwright/test";

/**
 * 删除确认交互（第 4 步）的端到端验证。
 *
 * 这三条路径此前完全没有 E2E 覆盖：删会话、管理员批量删除、设置页清理策略。
 * 而第 4 步恰好重写了它们的确认交互（含把设置页拆成两个异步函数），
 * 属于"改了但从没执行过"的高风险区。
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("删除确认交互", () => {
  // 聊天会话列表在侧栏，而侧栏是 `hidden sm:flex`——390px 下不渲染，
  // 移动端也还没有会话列表入口（chat-client.tsx 里标注"可后续加"）。
  // 这是既有设计，不是本次改动引入的，故这两例只在 sm 以上视口跑。
  test.describe("会话（需侧栏，跳过移动端）", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 640, "会话侧栏在 640px 以下不渲染");

    test("删会话：确认后会话消失", async ({ page }) => {
      // 先建一个会话，避免依赖既有数据
      const created = await page.request.post("/api/chat/conversations");
      expect(created.ok()).toBeTruthy();
      const convId = (await created.json()).data.id;

      await page.goto("/chat");
      const item = page.locator(`text=新会话`).first();
      await expect(item).toBeVisible({ timeout: 10000 });

      // hover 出删除按钮（默认 opacity-0）
      const row = page.locator("div.group").filter({ hasText: "新会话" }).first();
      await row.hover();
      await row.getByRole("button", { name: "删除会话" }).click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("永久删除");

      const deleted = page.waitForResponse(
        (r) => r.request().method() === "DELETE" && r.url().includes(`/api/chat/conversations/${convId}`),
      );
      await dialog.getByRole("button", { name: "永久删除" }).click();
      expect((await deleted).status()).toBe(200);

      // 接口层确认真的没了
      const list = await (await page.request.get("/api/chat/conversations")).json();
      expect(list.data.some((c: { id: string }) => c.id === convId)).toBe(false);
    });

    test("删会话：Esc 取消则不删", async ({ page }) => {
      const created = await page.request.post("/api/chat/conversations");
      const convId = (await created.json()).data.id;

      await page.goto("/chat");
      const row = page.locator("div.group").filter({ hasText: "新会话" }).first();
      await expect(row).toBeVisible({ timeout: 10000 });
      await row.hover();
      await row.getByRole("button", { name: "删除会话" }).click();

      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      const list = await (await page.request.get("/api/chat/conversations")).json();
      expect(list.data.some((c: { id: string }) => c.id === convId)).toBe(true);

      // 清理本用例造的数据
      await page.request.delete(`/api/chat/conversations/${convId}`);
    });
  });

  test("管理员批量删除：需逐字输入才能确认", async ({ page }) => {
    await page.goto("/admin/storage");
    await expect(page.getByRole("heading", { name: "存储清理" })).toBeVisible({ timeout: 10000 });

    // 页面加载后会自动全选当前页
    const deleteBtn = page.getByRole("button", { name: /删除选中/ });
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });
    await deleteBtn.click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();

    // 未输入时确认按钮应被禁用——这是防手滑的关键
    const confirmBtn = dialog.getByRole("button", { name: "永久删除" });
    await expect(confirmBtn).toBeDisabled();

    // 输错也不行
    await dialog.getByRole("textbox").fill("删");
    await expect(confirmBtn).toBeDisabled();

    // 输对才放行
    await dialog.getByRole("textbox").fill("删除");
    await expect(confirmBtn).toBeEnabled();

    // 不实际删除，取消退出
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
  });

  test("设置页清理策略：确认弹窗显示影响面且取消不生效", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /存储与自动清理/ })).toBeVisible({ timeout: 10000 });

    const before = await (await page.request.get("/api/admin/cleanup-policy")).json();
    const origDays = before.data.retentionDays;

    // 改一个明显不同的值，触发影响面预览
    const daysInput = page.getByLabel(/保留天数/);
    await daysInput.fill("9");
    await page.getByRole("button", { name: /保存并立即清理/ }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // 影响面文案必须出现（这是管理员做决定的依据）
    await expect(dialog).toContainText("下次清理将删除");
    await expect(dialog).toContainText("资产");
    await expect(dialog).toContainText("上传图");

    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();

    // 取消后策略不该被写库
    const after = await (await page.request.get("/api/admin/cleanup-policy")).json();
    expect(after.data.retentionDays).toBe(origDays);
  });
});
