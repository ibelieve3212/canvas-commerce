import { defineConfig, devices } from "@playwright/test";

const BASE = process.env.APP_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  // 生成类用例要等 mock provider 出图（6 张可达 20s+），
  // 用例内部的 expect timeout 最大 120s，test timeout 必须大于它，否则永远先超时
  timeout: 180_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  // 全部用例共用同一个 SQLite 库和同一对 seed 账号（admin/user）：
  // user-mgmt 会停用/重置密码（会摧毁别的用例正在用的 user 会话），admin-apps 会下架应用。
  // fullyParallel 会把各文件的 test 打散交错，即使 workers=1 也会互相干扰出假失败（401 / 应用卡找不到）。
  // 因此固定为单 worker + 不打散，文件内按声明顺序串行。
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-1920", use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } } },
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE,
        timeout: 120_000,
        reuseExistingServer: true,
      },
});
