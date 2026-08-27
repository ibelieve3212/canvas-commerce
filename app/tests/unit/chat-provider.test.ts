/**
 * @vitest-environment node
 *
 * 聊天渠道配置解析。
 *
 * 回归的 bug：管理员在"全局渠道"填了 chat 配置、提示保存成功，但聊天时仍报
 * "请配置 chat 渠道"。根因是前端 handleSaveAdminDefault 只提交生图三个字段，
 * 从不提交 chat*（后端 PATCH 一直支持），所以 SystemSetting 里那三条从没写入过。
 * 另外"沿用图像渠道"只填 Base URL 不填 key，而判定要求两者都有。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runMigrations } from "../../scripts/migrate.mjs";

const REAL_DB = ".data/db/dev.db";
const hasFixture = fs.existsSync(REAL_DB);

let sandbox: string;
let getChatProviderConfig: typeof import("@/server/chat/provider").getChatProviderConfig;
let prisma: typeof import("@/server/db/client").prisma;
let userId: string;

beforeAll(async () => {
  if (!hasFixture) return;
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "cc-chat-"));
  const dbPath = path.join(sandbox, "test.db");
  fs.copyFileSync(REAL_DB, dbPath);
  runMigrations(dbPath, "prisma/migrations", () => {});

  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";
  // 清掉 env 兜底，否则测不出"确实没渠道"的分支
  process.env.CCLOAD_NEW_API_BASE_URL = "";
  process.env.CCLOAD_NEW_API_TOKEN = "";

  getChatProviderConfig = (await import("@/server/chat/provider")).getChatProviderConfig;
  prisma = (await import("@/server/db/client")).prisma;
  userId = (await prisma.user.findFirstOrThrow()).id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

/** 每个用例前把用户级与全局配置清干净，避免互相污染 */
beforeEach(async () => {
  if (!hasFixture) return;
  await prisma.user.update({
    where: { id: userId },
    data: {
      chatBaseUrl: null,
      chatApiKey: null,
      chatModel: null,
      chatUseImageChannel: false,
      // 默认不跟随全局，这样测的是用户级优先级；跟随全局的场景单独设
      useGlobalChat: false,
      useGlobalProvider: false,
      providerBaseUrl: null,
      providerApiKey: null,
      providerModel: null,
    },
  });
  await prisma.systemSetting.deleteMany({
    where: { key: { in: ["chat_base_url", "chat_api_key", "chat_model", "provider_base_url", "provider_api_key", "provider_model"] } },
  });
});

async function setGlobal(pairs: Record<string, string>) {
  for (const [key, value] of Object.entries(pairs)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

describe.runIf(hasFixture)("getChatProviderConfig", () => {
  it("什么都没配时返回 null", async () => {
    expect(await getChatProviderConfig(userId)).toBeNull();
  });

  it("管理员配了全局聊天渠道 → 普通用户可用（原 bug 场景）", async () => {
    await setGlobal({
      chat_base_url: "https://global.example.com",
      chat_api_key: "sk-global",
      chat_model: "gpt-4o-mini",
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg).toEqual({
      baseUrl: "https://global.example.com",
      apiKey: "sk-global",
      model: "gpt-4o-mini",
    });
  });

  it("用户级配置优先于全局", async () => {
    await setGlobal({ chat_base_url: "https://global.example.com", chat_api_key: "sk-global" });
    await prisma.user.update({
      where: { id: userId },
      data: { chatBaseUrl: "https://mine.example.com", chatApiKey: "sk-mine", chatModel: "my-model" },
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://mine.example.com");
    expect(cfg?.model).toBe("my-model");
  });

  it("只填了 baseUrl 没填 key 不算已配置（旧'沿用图像渠道'按钮的坑）", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { chatBaseUrl: "https://mine.example.com", chatApiKey: null },
    });
    // 不该把半套配置当可用，应继续往下回退——此时无其它配置，故为 null
    expect(await getChatProviderConfig(userId)).toBeNull();
  });

  it("勾选'与生图渠道相同'时复用生图的地址与 key，一次都不用填 chat key", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        chatUseImageChannel: true,
        providerBaseUrl: "https://img.example.com",
        providerApiKey: "sk-img",
        chatModel: "gpt-4o",
      },
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://img.example.com");
    expect(cfg?.apiKey).toBe("sk-img");
    // 生图模型不能拿来聊天，模型必须走 chat 自己的配置
    expect(cfg?.model).toBe("gpt-4o");
  });

  it("勾了'与生图相同'但生图也没配 → 继续回退，不返回半套配置", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { chatUseImageChannel: true },
    });
    expect(await getChatProviderConfig(userId)).toBeNull();
  });

  it("没配 chat 但配了全局生图渠道 → 借用它（同平台通常也提供 chat）", async () => {
    await setGlobal({ provider_base_url: "https://img.example.com", provider_api_key: "sk-img" });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://img.example.com");
    expect(cfg?.apiKey).toBe("sk-img");
    expect(cfg?.model).toBe("gpt-4o");
  });

  it("全局 chat 优先于借用生图渠道", async () => {
    await setGlobal({
      provider_base_url: "https://img.example.com",
      provider_api_key: "sk-img",
      chat_base_url: "https://chat.example.com",
      chat_api_key: "sk-chat",
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://chat.example.com");
  });

  it("勾了'使用系统默认聊天渠道'时，用户级配置被跳过", async () => {
    // 这是新加的显式开关。此前判断依据是"用户级字段为空即跟随全局"，
    // 那是隐式规则：用户想切回全局就得先手动清空自己的配置。
    await setGlobal({ chat_base_url: "https://global.example.com", chat_api_key: "sk-global" });
    await prisma.user.update({
      where: { id: userId },
      data: {
        useGlobalChat: true,
        // 用户级配置还留着，但因为勾了跟随全局，不该生效
        chatBaseUrl: "https://mine.example.com",
        chatApiKey: "sk-mine",
      },
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://global.example.com");
  });

  it("勾了跟随全局时，'与生图渠道相同'也被跳过", async () => {
    await setGlobal({ chat_base_url: "https://global.example.com", chat_api_key: "sk-global" });
    await prisma.user.update({
      where: { id: userId },
      data: {
        useGlobalChat: true,
        chatUseImageChannel: true,
        providerBaseUrl: "https://img.example.com",
        providerApiKey: "sk-img",
      },
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://global.example.com");
  });

  it("跟随全局时用户仍可自选聊天模型", async () => {
    // 渠道跟全局，但模型是个人偏好——同一渠道下换模型是常见需求
    await setGlobal({
      chat_base_url: "https://global.example.com",
      chat_api_key: "sk-global",
      chat_model: "gpt-4o",
    });
    await prisma.user.update({
      where: { id: userId },
      data: { useGlobalChat: true, chatModel: "claude-sonnet-4" },
    });
    const cfg = await getChatProviderConfig(userId);
    expect(cfg?.baseUrl).toBe("https://global.example.com");
    expect(cfg?.model).toBe("claude-sonnet-4");
  });
});
