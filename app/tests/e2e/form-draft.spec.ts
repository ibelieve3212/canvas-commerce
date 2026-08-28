/* eslint-disable @typescript-eslint/no-require-imports */
import { test, expect } from "@playwright/test";

/** 上传有最小像素限制，1x1 的 PNG 会被拒。造一张 256x256 的。 */
function makePng256(): Buffer {
  const zlib = require("node:zlib");
  const W = 256, H = 256;
  const rowSize = W * 4 + 1;
  const raw = Buffer.alloc(rowSize * H);
  for (let y = 0; y < H; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * rowSize + 1 + x * 4;
      raw[o] = 200; raw[o + 1] = 200; raw[o + 2] = 200; raw[o + 3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type: string, data: Buffer): Buffer {
    const tb = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = zlib.crc32(Buffer.concat([tb, data]));
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, tb, data, cb]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

const VALID_PNG = makePng256();

/**
 * 表单草稿：填了一半跑去别的页面，回来内容还在。
 * 这是用户的原始诉求——去聊天页复制卖点再切回来。
 */
test.describe("表单草稿暂存", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");
  });

  test("切到聊天页再回来，填写内容与提示都在", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("T型艾草蒲团");
    await page.getByLabel("类目").fill("养生");

    // 模拟去聊天页复制卖点
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat/);
    await page.goto("/apps/main-image");

    await expect(page.getByLabel("商品名")).toHaveValue("T型艾草蒲团");
    await expect(page.getByLabel("类目")).toHaveValue("养生");
    await expect(page.getByText(/已恢复.*未提交的填写内容/)).toBeVisible();
  });

  test("刷新页面同样保留", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("刷新测试");
    await page.reload();
    await expect(page.getByLabel("商品名")).toHaveValue("刷新测试");
  });

  test("提交后草稿清空，下次进来是空表单", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("提交后应清空");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 \d 张/ }).click();
    await expect(page.getByText(/完成 \d\/\d/)).toBeVisible({ timeout: 30000 });

    // 重新进入：草稿应已被清掉
    await page.goto("/apps/main-image");
    await expect(page.getByLabel("商品名")).toHaveValue("");
    await expect(page.getByText(/已恢复.*未提交的填写内容/)).toBeHidden();
  });

  test("不同应用的草稿互不干扰", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("主图的内容");

    await page.goto("/apps/detail-page");
    await expect(page.getByLabel("商品名")).toHaveValue("");
    await page.getByLabel("商品名").fill("详情页的内容");

    await page.goto("/apps/main-image");
    await expect(page.getByLabel("商品名")).toHaveValue("主图的内容");
  });
});
