/**
 * 应用列表查询服务。
 * 阶段6起改为数据库优先，支持 isPublished / sortOrder 动态管理。
 */
import { prisma } from "@/server/db/client";
import { builtinApplications, getApplicationBySlug } from "./seed";
import type { Application, ApplicationCategory } from "@/contracts/application";

/** 从数据库读取已发布应用（按 sortOrder 排序） */
export async function listPublishedApplications(): Promise<Application[]> {
  try {
    const dbApps = await prisma.application.findMany({
      where: { isPublished: true },
      orderBy: { sortOrder: "asc" },
    });
    if (dbApps.length === 0) {
      // fallback to memory
      return builtinApplications.filter((a) => a.isPublished);
    }
    return dbApps.map(dbAppToApplication);
  } catch {
    return builtinApplications.filter((a) => a.isPublished);
  }
}

/** 管理员列表（含未发布） */
export async function listAllApplications(): Promise<Application[]> {
  try {
    const dbApps = await prisma.application.findMany({
      orderBy: { sortOrder: "asc" },
    });
    return dbApps.map(dbAppToApplication);
  } catch {
    return builtinApplications;
  }
}

function dbAppToApplication(db: {
  id: string; slug: string; name: string; description: string;
  kind: string; visibility: string; category: string;
  emojiIcon: string | null; tagline: string; tagsJson: string;
  outputConfigJson: string; outputRolesJson: string; formSchemaJson: string;
  promptTemplate: string; templateVersion: number; isPublished: boolean; sortOrder: number;
}): Application {
  const memory = getApplicationBySlug(db.slug);
  return {
    id: db.id,
    slug: db.slug,
    name: db.name,
    description: db.description,
    kind: db.kind as Application["kind"],
    visibility: db.visibility as Application["visibility"],
    category: db.category as ApplicationCategory,
    emojiIcon: db.emojiIcon ?? undefined,
    tagline: db.tagline,
    tags: JSON.parse(db.tagsJson),
    outputConfig: JSON.parse(db.outputConfigJson),
    outputRoles: JSON.parse(db.outputRolesJson),
    formSchema: memory?.formSchema ?? JSON.parse(db.formSchemaJson),
    promptTemplate: db.promptTemplate,
    templateVersion: db.templateVersion,
    isPublished: db.isPublished,
    sortOrder: db.sortOrder,
    defaultAspectRatio: memory?.defaultAspectRatio ?? "1:1",
  } as unknown as Application;
}

export function filterApplications(
  apps: Application[],
  opts: { q: string; category: ApplicationCategory },
): Application[] {
  const q = opts.q.trim().toLowerCase();
  return apps.filter((app) => {
    if (opts.category !== "ALL") {
      if (opts.category === "MINE") return false; // 阶段1无私有应用
      if (app.category !== opts.category) return false;
    }
    if (q) {
      const haystack = [
        app.name,
        app.description,
        app.tagline,
        app.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export async function getApplication(slug: string): Promise<Application | undefined> {
  try {
    const dbApp = await prisma.application.findUnique({ where: { slug } });
    if (!dbApp) return getApplicationBySlug(slug);
    return dbAppToApplication(dbApp);
  } catch {
    return getApplicationBySlug(slug);
  }
}

