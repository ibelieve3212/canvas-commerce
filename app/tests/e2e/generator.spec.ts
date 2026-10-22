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
    // roles 模式：位次默认一个都不勾，按钮文案会拦住空提交
    await expect(page.getByRole("button", { name: "请勾选主图类型" })).toBeVisible();
    await page.getByRole("button", { name: "高点击首图" }).click();
    await expect(page.getByRole("button", { name: /生成 1 张商品主图/ })).toBeVisible();

    await page.getByLabel("商品名").fill("测试商品");
    await page.getByLabel("类目").fill("数码");
    // 填商品信息才不会触发"图上文案将由 AI 自行提炼"确认框。
    // 该确认框自己的行为在下面几个用例里测。
    await page.getByLabel("商品信息").fill("音质好、续航长");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png",
      mimeType: "image/png",
      buffer: VALID_PNG,
    });
    // 等待上传完成
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张商品主图/ }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });
  });

  test("买家秀真实度滑块和比例选项可操作", async ({ page }) => {
    await page.goto("/apps/buyer-show");
    await expect(page.getByRole("button", { name: /生成 1 张/ })).toBeVisible();
    await expect(page.getByLabel("真实度")).toBeVisible();
    await expect(page.locator("#aspect")).toBeVisible();
  });
});

/**
 * 主图的"带卖点文字"开关（勾选即为默认）：
 * - 勾了但「商品信息」留空 → 图上文字由模型自己提炼，可能写出商品图上看不清的卖点
 * - 取消勾选 → 出的是不带任何文字的纯图
 * 两种都不是错误，但用户看不到结果就得白跑一整批（一张 45-95 秒），
 * 所以提交前各拦一次——弹窗里的措辞就是用户能看到的全部信息，逐字断言。
 */
test.describe("主图卖点文字确认", () => {
  test("勾选卖点文字但没填商品信息时，点生成先弹确认而不是直接开跑", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByRole("button", { name: "高点击首图" }).click();
    await page.getByLabel("商品名").fill("无文案测试");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张商品主图/ }).click();

    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByText("图上文案将由 AI 自行提炼")).toBeVisible();
    // 提示要点名该应用真实存在的字段，说错名字用户会去找不存在的输入框
    await expect(page.getByRole("alertdialog")).toContainText("商品信息");

    // 取消则不提交：结果区不该出现进度
    await page.getByRole("button", { name: "返回填写" }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText(/完成 \d\/1/)).toBeHidden();
  });

  test("确认后照常生成", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByRole("button", { name: "高点击首图" }).click();
    await page.getByLabel("商品名").fill("确认后生成");
    await page.getByLabel("类目").fill("数码");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张商品主图/ }).click();
    await page.getByRole("button", { name: "让 AI 自己写" }).click();

    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });
  });

  test("取消勾选卖点文字时，提醒这批图不带任何文字", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByRole("button", { name: "高点击首图" }).click();
    await page.getByLabel("商品名").fill("无字纯图");
    await page.getByLabel("类目").fill("数码");
    await page.getByLabel("主图带卖点文字").uncheck();
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张商品主图/ }).click();

    await expect(page.getByText("生成的会是不带文字的纯图片")).toBeVisible();
    await page.getByRole("button", { name: "就要无文案的图" }).click();
    await expect(page.getByText("完成 1/1")).toBeVisible({ timeout: 60000 });
  });

  test("填了商品信息就不再拦", async ({ page }) => {
    await page.goto("/apps/main-image");
    await page.getByRole("button", { name: "高点击首图" }).click();
    await page.getByLabel("商品名").fill("有文案");
    await page.getByLabel("类目").fill("数码");
    await page.getByLabel("商品信息").fill("音质好、续航长");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张商品主图/ }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText(/完成 \d\/1/)).toBeVisible({ timeout: 15000 });
  });

  test("买家秀不弹这个确认——它的模板不吃文案指令", async ({ page }) => {
    await page.goto("/apps/buyer-show");
    await page.getByLabel("商品名").fill("买家秀无文案");
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /添加商品图/ }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: "t.png", mimeType: "image/png", buffer: VALID_PNG });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 1 张/ }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText(/完成 \d\/1/)).toBeVisible({ timeout: 15000 });
  });

  test("详情页卖点必填，正常填完不会被拦", async ({ page }) => {
    await page.goto("/apps/detail-page");
    await page.getByLabel("商品名").fill("详情页有卖点");
    await page.getByLabel("类目").fill("数码");
    await page.getByLabel("商品卖点").fill("音质好\n续航长");
    await page.locator('input[type="file"]').nth(1).setInputFiles({
      name: "t.png", mimeType: "image/png", buffer: VALID_PNG,
    });
    await expect(page.getByAltText("素材 1")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /生成 6 张/ }).click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(page.getByText(/完成 \d\/6/)).toBeVisible({ timeout: 15000 });
  });
});
