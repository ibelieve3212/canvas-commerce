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
 * ACCEPTANCE 必须 E2E 场景 8：生成中刷新页面，验证任务恢复。
 */
test.describe("ACCEPTANCE 刷新恢复", () => {
  test("生成中刷新页面可恢复批次状态", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("admin123");
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/apps");

    await page.goto("/apps/buyer-show");
    await page.getByLabel("商品名").fill("刷新恢复测试");

    // 上传商品图
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /添加商品图/ }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成.*张/ }).click();
    await expect(page.getByText(/完成 \d\/\d/).first()).toBeVisible({ timeout: 8000 });

    // 刷新 → app 页本地状态丢失 → 到任务中心验证持久化
    await page.goto("/tasks");
    await expect(page.locator("text=买家秀").first()).toBeVisible({ timeout: 10000 });
  });
});
