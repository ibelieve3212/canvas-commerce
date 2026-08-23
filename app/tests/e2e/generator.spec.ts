/* eslint-disable @typescript-eslint/no-require-imports */
import { test, expect } from "@playwright/test";

// 生成一个 256x256 纯色 PNG（通过测试工具）
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

// 认证：全局 setup 在 beforeEach 登录
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("阶段2 生成器", () => {
  test("AI 详情页表单校验必填并提示错误", async ({ page }) => {
    await page.goto("/apps/detail-page");
    await page.getByRole("button", { name: /生成 6 张/ }).click();

    await expect(page.getByText("请修正标红字段后再提交")).toBeVisible();
  });

  test("AI 详情页提交后逐张完成", async ({ page }) => {
    await page.goto("/apps/detail-page");

    await page.getByLabel("商品名").fill("测试音箱");
    await page.getByLabel("类目").fill("数码 / 音箱");
    await page.getByLabel("商品卖点").fill("音质好\n续航长\n防水");

    // 上传商品图（第 2 个 image 字段是 product）
    const productInput = page.locator('input[type="file"]').nth(1);
    await productInput.setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    // 等待上传完成
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 6 张/ }).click();

    // 6 张结果卡出现（进度条出现）
    await expect(page.getByText(/完成 \d\/6/)).toBeVisible({ timeout: 15000 });

    // 等待全部完成
    await expect(page.getByText("完成 6/6")).toBeVisible({ timeout: 120000 });
  });

  test("商品主图生成 1 张", async ({ page }) => {
    await page.goto("/apps/main-image");
    await expect(page.getByRole("button", { name: /生成 1 张/ })).toBeVisible();

    await page.getByLabel("商品名").fill("测试商品");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    // 等待上传完成
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByText("吸睛主图")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });
  });

  test("买家秀真实度滑块和比例选项可操作", async ({ page }) => {
    await page.goto("/apps/buyer-show");
    await expect(page.getByRole("button", { name: /生成 1 张/ })).toBeVisible();
    await expect(page.getByLabel("真实度")).toBeVisible();
    await expect(page.locator("#aspect")).toBeVisible();
  });
});
