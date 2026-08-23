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

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("阶段4 任务和资产", () => {
  test("生成后任务中心显示批次", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("任务测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText(/完成 \d\/1/)).toBeVisible({ timeout: 15000 });

    await page.goto("/tasks");
    // 任务中心列表里会用应用名显示
    await expect(page.locator("text=商品主图").first()).toBeVisible({ timeout: 5000 });
  });

  test("生成后资产库显示图片", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("资产测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    await page.goto("/assets");
    await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });
  });

  test("资产库收藏后刷新保持", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("收藏测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    await page.goto("/assets");
    const favBtn = page.getByRole("button", { name: /收藏/ }).first();
    await expect(favBtn).toBeVisible({ timeout: 10000 });
    await favBtn.click();

    await page.reload();
    await expect(page.getByRole("button", { name: /已收藏|取消收藏/ }).first()).toBeVisible({ timeout: 10000 });
  });

  test("可软删除任务", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("删除测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText(/完成 \d\/1/)).toBeVisible({ timeout: 15000 });

    await page.goto("/tasks");
    await expect(page.locator("text=商品主图").first()).toBeVisible({ timeout: 5000 });
    const deleteBtn = page.getByRole("button", { name: /删除/ }).first();
    await deleteBtn.click();
    await page.reload();
    await expect(page.getByText("删除测试")).not.toBeVisible({ timeout: 5000 });
  });

  test("可恢复配置到生成器", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("版本A");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    await page.goto("/tasks");
    const restoreBtn = page.getByRole("button", { name: "恢复配置" }).first();
    await expect(restoreBtn).toBeVisible({ timeout: 5000 });
    await restoreBtn.click();
    // 应跳转到生成器页面，URL 带 fromBatch
    await expect(page).toHaveURL(/\/apps\/.*\?fromBatch=/, { timeout: 10000 });
    // 应恢复商品名
    await expect(page.getByLabel("商品名")).toHaveValue("版本A");
  });

  test("收藏筛选可切换", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByRole("button", { name: "全部图片" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "已收藏" })).toBeVisible();
  });
});
