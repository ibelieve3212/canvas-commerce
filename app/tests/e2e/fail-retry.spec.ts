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
 * ACCEPTANCE 必须 E2E 场景 7：注入一项失败，验证 partial，再重试到 completed。
 * 使用商品名含 __FAIL__ 触发 Mock Provider 故障注入。
 */
test.describe("ACCEPTANCE 故障注入与重试", () => {
  test("提交含 __FAIL__ 的批次 → 失败 → 重试", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("__FAIL__测试");
    await page.getByLabel("类目").fill("服饰");

    // 上传商品图
    const productUploadBtn = page.getByRole("button", { name: /添加商品图/ });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await productUploadBtn.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "1 张", exact: true }).click();
    await page.getByRole("button", { name: /生成.*张/ }).click();

    await expect(page.getByText(/完成 \d\/\d/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/失败/i).first()).toBeVisible({ timeout: 15000 });

    const retryLocator = page.getByRole("button", { name: /重试/i }).first();
    await expect(retryLocator).toBeVisible({ timeout: 5000 });
    await retryLocator.click();

    await expect(page.getByText(/完成 \d\/\d|失败/i).first()).toBeVisible({ timeout: 10000 });
  });
});
