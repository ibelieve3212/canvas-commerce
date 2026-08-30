/**
 * @vitest-environment node
 *
 * 存储读取授权。
 *
 * 两个实测 bug 的回归：
 *   1. 聊天页切走再回来，贴图全裂。key 是 chat/{convId}/{uuid}，
 *      路径里没有 userId，旧实现只按 `{userId}/` 前缀比对 → 一律 403。
 *      对话进行中不裂是因为前端显示的是 FileReader 的 base64 预览。
 *   2. 管理员存储页图片全裂。该页跨用户展示全库资产，但旧实现只放行
 *      请求者自己的图。本地单账号看不出来，服务器多用户环境全裂。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { runMigrations } from "../../scripts/migrate.mjs";
import { createSandbox, hasFixture } from "../fixtures/sandbox";

let sandbox: string;
let authorizeStorageRead: typeof import("@/server/storage/authorize").authorizeStorageRead;
let prisma: typeof import("@/server/db/client").prisma;

/** 会话的主人 */
let ownerId: string;
/** 另一个普通用户，用来验越权 */
let otherUserId: string;
let adminId: string;
let conversationId: string;

beforeAll(async () => {
  if (!hasFixture) return;
  const sb = createSandbox("cc-auth-", false);
  sandbox = sb.root;
  runMigrations(sb.dbPath, "prisma/migrations", () => {});

  process.env.DATABASE_URL = `file:${sb.dbPath}`;
  process.env.STORAGE_LOCAL_PATH = sb.storagePath;
  process.env.AUTH_SECRET ||= "test-secret-at-least-16-chars";

  authorizeStorageRead = (await import("@/server/storage/authorize")).authorizeStorageRead;
  prisma = (await import("@/server/db/client")).prisma;

  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  adminId = admin.id;

  // 造两个普通用户：会话主人 + 无关第三方
  const owner = await prisma.user.create({
    data: { username: `owner-${Date.now()}`, name: "会话主人", passwordHash: "x", role: "USER" },
  });
  ownerId = owner.id;
  const other = await prisma.user.create({
    data: { username: `other-${Date.now()}`, name: "第三方", passwordHash: "x", role: "USER" },
  });
  otherUserId = other.id;

  const conv = await prisma.chatConversation.create({
    data: { userId: ownerId, title: "测试会话" },
  });
  conversationId = conv.id;
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

const asUser = (id: string) => ({ id, role: "USER" as const });
const asAdmin = (id: string) => ({ id, role: "ADMIN" as const });

describe.runIf(hasFixture)("聊天贴图", () => {
  it("会话主人能读自己会话里的贴图", async () => {
    const key = `chat/${conversationId}/abc.png`;
    expect(await authorizeStorageRead(key, asUser(ownerId))).toEqual({ ok: true });
  });

  it("别人读不到——这是私人对话", async () => {
    const key = `chat/${conversationId}/abc.png`;
    const r = await authorizeStorageRead(key, asUser(otherUserId));
    expect(r.ok).toBe(false);
  });

  it("管理员同样读不到聊天贴图", async () => {
    // 聊天比商品图敏感得多，而管理端存储页只列 Asset 表、
    // 从不展示聊天贴图，放开它没有任何功能收益
    const key = `chat/${conversationId}/abc.png`;
    const r = await authorizeStorageRead(key, asAdmin(adminId));
    expect(r.ok).toBe(false);
  });

  it("会话不存在时报 403 而不是放行", async () => {
    const r = await authorizeStorageRead("chat/nonexistent-conv/abc.png", asUser(ownerId));
    expect(r.ok).toBe(false);
  });

  it("畸形的 chat 路径不放行", async () => {
    // 段数不足，取不出 conversationId
    for (const key of ["chat/", "chat/onlyconv", "chat//abc.png"]) {
      const r = await authorizeStorageRead(key, asUser(ownerId));
      expect(r.ok, key).toBe(false);
    }
  });
});

describe.runIf(hasFixture)("生成图与上传图", () => {
  it("能读自己的图（新路径）", async () => {
    expect(await authorizeStorageRead(`${ownerId}/x.png`, asUser(ownerId))).toEqual({ ok: true });
  });

  it("能读自己的图（OPT-3 前的老路径）", async () => {
    // 存量数据仍是 users/{userId}/{category}/{yyyy}/{mm}/{uuid}.ext
    const key = `users/${ownerId}/generated/2026/01/x.png`;
    expect(await authorizeStorageRead(key, asUser(ownerId))).toEqual({ ok: true });
  });

  it("普通用户读不到别人的图", async () => {
    const r = await authorizeStorageRead(`${otherUserId}/x.png`, asUser(ownerId));
    expect(r.ok).toBe(false);
    const r2 = await authorizeStorageRead(`users/${otherUserId}/a/b/c/x.png`, asUser(ownerId));
    expect(r2.ok).toBe(false);
  });

  it("管理员可读任意用户的图——存储页要看到画面才能决定删哪些", async () => {
    expect(await authorizeStorageRead(`${ownerId}/x.png`, asAdmin(adminId))).toEqual({ ok: true });
    expect(await authorizeStorageRead(`${otherUserId}/x.png`, asAdmin(adminId))).toEqual({
      ok: true,
    });
    expect(
      await authorizeStorageRead(`users/${otherUserId}/a/b/c/x.png`, asAdmin(adminId)),
    ).toEqual({ ok: true });
  });

  it("前缀必须完整匹配到目录分隔符，不能靠 id 开头蹭进去", async () => {
    // 若用 startsWith(id) 而漏了斜杠，`{ownerId}extra/x.png` 会被误放行
    const r = await authorizeStorageRead(`${ownerId}extra/x.png`, asUser(ownerId));
    expect(r.ok).toBe(false);
  });

  it("缩略图与原图同一目录，走同一条规则", async () => {
    expect(await authorizeStorageRead(`${ownerId}/x.thumb.jpg`, asUser(ownerId))).toEqual({
      ok: true,
    });
  });
});
