/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 图片处理工具（IMAGE_TOOL / per_image）端到端冒烟：
 * - 应用中心 IMAGE 分类能看到三个工具
 * - 白底图：初始无图时按钮禁文案 → 传 1 张 → 计数变 1 → 完成 1/1
 * - 一键精修：一次传 2 张 → 两个任务 → 完成 2/2
 * - AI 变清晰：页面可进、上传控件存在
 */
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

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/apps");
});

test.describe("图片处理工具", () => {
  test("应用中心图片处理分类展示三个工具", async ({ page }) => {
    await page.getByRole("button", { name: "图片处理", exact: true }).click();
    await expect(page.getByRole("link", { name: /白底图/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /一键精修/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /AI 变清晰/ })).toBeVisible();
  });

  test("白底图：上传 1 张，一张一任务，完成 1/1", async ({ page }) => {
    await page.goto("/apps/white-background");

    // 没传图时按钮提示上传，而不是假装能生成
    await expect(page.getByRole("button", { name: "上传图片后开始" })).toBeVisible();
    // 有输出比例单选，默认 1:1
    await expect(page.locator("#aspect")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles({
      name: "white.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    // 计数跟随上传图数派生：开始处理（1 张）
    await expect(page.getByRole("button", { name: /开始处理（1 张）/ })).toBeVisible();
    await page.getByRole("button", { name: /开始处理（1 张）/ }).click();

    // 30s：全量/单独跑时首个导航可能撞上 dev 冷编译
    await expect(page.getByText(/完成 \d\/1/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });
  });

  test("一键精修：一次传 2 张，两个任务，完成 2/2", async ({ page }) => {
    await page.goto("/apps/image-retouch");

    await page.locator('input[type="file"]').first().setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: VALID_PNG },
      { name: "b.png", mimeType: "image/png", buffer: VALID_PNG },
    ]);
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });
    await expect(page.getByAltText("素材 2")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /开始处理（2 张）/ }).click();

    await expect(page.getByText(/完成 \d\/2/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("完成 2/2")).toBeVisible({ timeout: 120000 });
  });

  test("AI 变清晰：页面可进，含上传控件", async ({ page }) => {
    await page.goto("/apps/image-clarity");
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "上传图片后开始" })).toBeVisible();
  });
});
