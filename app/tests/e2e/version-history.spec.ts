/* eslint-disable @typescript-eslint/no-require-imports */
import { test, expect } from "@playwright/test";

function makePng256(): Buffer {
  const zlib = require("node:zlib");
  const W = 256, H = 256;
  const rowSize = W * 4 + 1;
  const raw = Buffer.alloc(rowSize * H);
  for (let y = 0; y < H; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * rowSize + 1 + x * 4;
      raw[o] = 200; raw[o+1] = 200; raw[o+2] = 200; raw[o+3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  function chunk(type: string, data: Buffer): Buffer {
    const tb = Buffer.from(type,"ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length,0);
    const crc = zlib.crc32(Buffer.concat([tb,data]));
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc>>>0,0);
    return Buffer.concat([len,tb,data,cb]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  return Buffer.concat([sig, chunk("IHDR",ihdr), chunk("IDAT",compressed), chunk("IEND",Buffer.alloc(0))]);
}

const VALID_PNG = makePng256();

/**
 * 阶段4 会话级出图历史：同一应用页面下所有生成批次可横向对比。
 */
test.describe("阶段4 会话历史", () => {
  test("生成后出图历史面板可见并显示历史批次", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("会话历史A");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    // 出图历史面板始终可见
    const historyToggle = page.getByRole("button", { name: /出图历史/ });
    await expect(historyToggle).toBeVisible({ timeout: 5000 });

    // 展开
    await historyToggle.click();
    // 应显示历史批次数量
    await expect(page.getByText(/次生成/)).toBeVisible({ timeout: 10000 });
  });

  test("未生成时出图历史面板仍可见（空态提示）", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/apps/poster");

    // 出图历史面板始终可见（不再依赖 batchId）
    const historyToggle = page.getByRole("button", { name: /出图历史/ });
    await expect(historyToggle).toBeVisible({ timeout: 5000 });

    // 展开
    await historyToggle.click();
    // 如果有历史批次则显示"次生成"，否则显示空态提示
    await expect(page.getByText(/次生成|暂无历史/).first()).toBeVisible({ timeout: 10000 });
  });

  test("任务中心恢复配置跳转到生成器并恢复参数", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    // 先生成一张
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("恢复参数测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    // 到任务中心
    await page.goto("/tasks");
    const restoreBtn = page.getByRole("button", { name: "恢复配置" }).first();
    await expect(restoreBtn).toBeVisible({ timeout: 5000 });
    await restoreBtn.click();

    // 应跳转到生成器页面，URL 带有 fromBatch
    await expect(page).toHaveURL(/\/apps\/.*\?fromBatch=/, { timeout: 10000 });

    // 应显示恢复提示
    await expect(page.getByText(/已从.*恢复参数/)).toBeVisible({ timeout: 10000 });

    // 表单应恢复商品名
    await expect(page.getByLabel("商品名")).toHaveValue("恢复参数测试");
  });
});
