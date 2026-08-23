/**
 * 构建期把 prisma/seed-prod.ts 打包成单文件 .mjs。
 *
 * 为什么：运行时镜像不带 tsx（3M + esbuild 二进制 10M），
 * 但容器启动需要 seed（同步内置应用 + 首次建管理员）。
 * 构建期打包一次，运行时零额外依赖。
 *
 * 注意入口是 seed-prod.ts 而非 seed.ts：后者会无条件重置管理员密码，
 * 在生产上等于每次重启把密码改回 admin123。
 *
 * 原生模块（better-sqlite3 / argon2 / @prisma/client）保持 external，
 * 由运行时的 node_modules 提供 —— 它们不能被打进单文件。
 */
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(appRoot, "prisma/seed-prod.ts")],
  outfile: path.join(appRoot, "dist/seed.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // 这些必须留在 external：原生 .node 二进制无法内联，
  // 且 @prisma/client 的生成产物在运行时 node_modules 里。
  external: ["@prisma/client", "@prisma/adapter-better-sqlite3", "better-sqlite3", "argon2"],
  // seed.ts 用 @/ 别名引 src/ 下的模块（builtinApplications、prisma client）
  alias: { "@": path.join(appRoot, "src") },
  logLevel: "info",
});

console.log("[build-seed] 已生成 dist/seed.mjs");
