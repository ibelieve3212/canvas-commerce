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

test.describe("OPT-1 微调", () => {
  test("商品主图生成后可微调，生成微调版本", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByLabel("商品名").fill("测试商品");
    await page.getByLabel("类目").fill("数码");
    // 填商品信息，否则会弹"这批图不会带任何文案"确认框（该行为在 generator.spec.ts 里测）
    await page.getByLabel("商品信息").fill("音质好、续航长");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /生成 1 张/ }).click();

    // 等待完成
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });

    // 点击微调按钮（OPT-1 已用模型微调替换系统文字层）
    await page.getByRole("button", { name: "微调" }).first().click();

    // 应出现微调面板
    await expect(page.getByText("微调原图")).toBeVisible({ timeout: 5000 });

    // 填微调描述
    await page
      .getByPlaceholder("例：把标题字号调大、移到左上角、改成红色")
      .fill("把标题字号调大");

    // 提交微调
    await page.getByRole("button", { name: "提交微调" }).click();

    // 微调完成后面板关闭，结果面板出现微调版本分支
    await expect(page.getByText("微调原图")).not.toBeVisible({ timeout: 60000 });
    await expect(page.getByText("微调版本")).toBeVisible({ timeout: 10000 });
  });

  test("商品主图支持 1/3/5 张数量选择", async ({ page }) => {
    await page.goto("/apps/main-image");

    // 默认 1 张
    await expect(page.getByText("生成数量")).toBeVisible();
    await expect(page.getByRole("button", { name: "1 张", exact: true })).toBeVisible();

    // 切换到 3 张
    const threeBtn = page.locator("button").filter({ hasText: /^3 张$/ });
    await threeBtn.click();
    await expect(page.getByRole("button", { name: /生成 3 张/ })).toBeVisible();

    // 切换到 5 张
    const fiveBtn = page.locator("button").filter({ hasText: /^5 张$/ });
    await fiveBtn.click();
    await expect(page.getByRole("button", { name: /生成 5 张/ })).toBeVisible();
  });
});
