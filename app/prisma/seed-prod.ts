/**
 * 生产 seed —— 容器每次启动都会跑，必须绝对幂等且不覆盖真实数据。
 *
 * 与 prisma/seed.ts（开发 seed）的区别：
 * - 开发 seed 用 upsert 无条件重置管理员密码，方便本地反复重来；
 *   生产上那等于每次重启把密码改回默认值，绝不能这么干。
 * - 生产 seed 只在"库里没有任何 ADMIN 角色用户"时才建管理员。
 *   按角色判断而非按 User 表是否为空 —— 后者会在"有普通用户但管理员被误删"
 *   的场景下拒绝创建，反而堵住恢复路径。
 * - 不建演示用户（user）。生产不需要。
 *
 * 可用 ADMIN_USERNAME / ADMIN_PASSWORD 覆盖默认值。
 *
 * 内置应用仍然每次 upsert：它们是应用模板而非用户数据，
 * 新版镜像可能改了 promptTemplate 或加了新应用，需要同步过去。
 */
import argon2 from "argon2";
import { builtinApplications } from "@/server/applications/seed";
import { prisma } from "@/server/db/client";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123";

async function syncBuiltinApplications() {
  for (const app of builtinApplications) {
    const shared = {
      name: app.name,
      description: app.description,
      kind: app.kind,
      category: app.category,
      emojiIcon: app.emojiIcon ?? null,
      tagline: app.tagline,
      tagsJson: JSON.stringify(app.tags),
      outputConfigJson: JSON.stringify(app.outputConfig),
      outputRolesJson: JSON.stringify(app.outputRoles),
      formSchemaJson: JSON.stringify(app.formSchema),
      promptTemplate: app.promptTemplate,
      defaultAspectRatio: app.defaultAspectRatio,
      templateVersion: app.templateVersion,
      isPublished: app.isPublished,
    };
    await prisma.application.upsert({
      where: { id: app.id },
      update: shared,
      create: { id: app.id, slug: app.slug, visibility: app.visibility, ...shared },
    });
  }
  console.log(`[seed] 内置应用已同步（${builtinApplications.length} 个）`);
}

async function ensureAdmin() {
  // 关键判断：只要存在任何管理员就跳过，不碰现有账号的密码。
  const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
  if (adminCount > 0) {
    console.log(`[seed] 已有 ${adminCount} 个管理员账号，跳过创建`);
    return;
  }

  const username = (process.env.ADMIN_USERNAME?.trim() || DEFAULT_ADMIN_USERNAME).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

  // 用户名可能已被一个非管理员账号占用（比如先建成了普通用户），
  // 这种情况提升角色而不是插入重复用户名撞唯一约束。
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "ADMIN", status: "ACTIVE" },
    });
    console.log(`[seed] 已把现有账号 ${username} 提升为管理员（未改密码）`);
    return;
  }

  const user = await prisma.user.create({
    data: {
      username,
      name: "管理员",
      passwordHash: await argon2.hash(password),
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log(`[seed] 已创建管理员账号：${username}（id=${user.id}）`);
  if (password === DEFAULT_ADMIN_PASSWORD) {
    console.log("");
    console.log("  ╔══════════════════════════════════════════════════╗");
    console.log("  ║  管理员使用的是默认密码 admin123                 ║");
    console.log("  ║  请立即登录并在设置页修改密码                    ║");
    console.log("  ╚══════════════════════════════════════════════════╝");
    console.log("");
  }
}

async function main() {
  await syncBuiltinApplications();
  await ensureAdmin();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("[seed] 失败:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
