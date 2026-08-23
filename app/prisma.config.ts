import path from "node:path";
import { PrismaConfig } from "prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7 配置：datasource url 从 schema 移到此处
// V2 固定 SQLite，路径与 .env 的 DATABASE_URL 保持一致
const dbPath = process.env.DATABASE_URL?.replace(/^file:/, "") || ".data/db/dev.db";

export default {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: `file:${dbPath}`,
  },
} satisfies PrismaConfig;
