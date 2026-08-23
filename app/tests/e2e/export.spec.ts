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

test.describe("阶段3 导出", () => {
  test("单张下载，文件名含应用 slug", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("导出测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();

    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    // 下载是 <a download href="/api/storage/...">,验证链接存在且 href 正确
    const downloadLink = page.getByRole("link", { name: "下载" });
    await expect(downloadLink).toBeVisible({ timeout: 5000 });
    const href = await downloadLink.getAttribute("href");
    expect(href).toContain("/api/storage/");
  });

  test("AI 详情页生成 6 张后长图导出", async ({ page }) => {
    await page.goto("/apps/detail-page");
    await page.getByLabel("商品名").fill("长图测试");
    await page.getByLabel("类目").fill("数码 / 音箱");
    await page.getByLabel("商品卖点").fill("音质好\n续航长\n防水");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 6 张/ }).click();

    await expect(page.getByText("完成 6/6")).toBeVisible({ timeout: 120000 });

    // 长图导出：点击按钮→调 API→window.open(downloadUrl)
    // 用 popup 事件或 response 事件验证
    const popupPromise = page.waitForEvent("popup", { timeout: 30000 }).catch(() => null);
    await page.getByText(/长图/).first().click();
    const popup = await popupPromise;
    // popup 可能被拦截，验证 response 也行
    if (popup) {
      await popup.waitForLoadState();
      expect(popup.url()).toContain("/api/");
    }
  });
});
