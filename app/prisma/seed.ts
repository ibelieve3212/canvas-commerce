/**
 * Prisma seed：内置应用 + 开发管理员 + 演示用户
 */
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { builtinApplications } from "../src/server/applications/seed";
import { prisma } from "../src/server/db/client";

async function main() {
  // ---- 内置应用 ----
  for (const app of builtinApplications) {
    await prisma.application.upsert({
      where: { id: app.id },
      update: {
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
      },
      create: {
        id: app.id,
        slug: app.slug,
        name: app.name,
        description: app.description,
        kind: app.kind,
        visibility: app.visibility,
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
      },
    });
  }
  console.log("✓ 4 内置应用已 seed");

  // ---- 开发管理员 ----
  const adminUsername = "admin";
  const adminPass = "admin123";
  const adminHash = await argon2.hash(adminPass);
  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: { role: "ADMIN", status: "ACTIVE", passwordHash: adminHash },
    create: {
      username: adminUsername,
      name: "管理员",
      passwordHash: adminHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  // 管理员配额
  await prisma.userQuota.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      dailyLimit: 999,
      totalQuota: 9999,
      maxConcurrency: 10,
      dailyDate: new Date().toISOString().slice(0, 10),
    },
  });
  console.log(`✓ 管理员: ${adminUsername} / ${adminPass}`);

  // ---- 演示用户 ----
  const demoUsername = "user";
  const userPass = "user123";
  const userHash = await argon2.hash(userPass);
  const user = await prisma.user.upsert({
    where: { username: demoUsername },
    update: { status: "ACTIVE", passwordHash: userHash },
    create: {
      username: demoUsername,
      name: "演示用户",
      passwordHash: userHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  await prisma.userQuota.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      dailyLimit: 20,
      totalQuota: 100,
      maxConcurrency: 2,
      dailyDate: new Date().toISOString().slice(0, 10),
    },
  });
  console.log(`✓ 演示用户: ${demoUsername} / ${userPass}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
