# syntax=docker/dockerfile:1.7
#
# CanvasCommerce 运行镜像。alpine + Next standalone。
#
# 设计要点（每条都是实测得出的，改动前请先读）：
#
# 1. 用 `--node-linker=hoisted` 装依赖。pnpm 默认的 isolated 布局会在
#    node_modules 顶层放**绝对路径**符号链接，standalone 产物照抄这些链接，
#    跨阶段 COPY 后全部指向不存在的路径。hoisted 布局全是真目录，可安全拷贝。
#    用 CLI flag 而不是改 .npmrc / pnpm-workspace.yaml —— 实测那两处的
#    nodeLinker 配置在本项目不生效（仍产出 .pnpm 布局），只有 CLI flag 有效。
#
# 2. 不装编译工具链（python3/make/g++）。三个原生模块都有 musl prebuild：
#    better-sqlite3 → linuxmusl-{x64,arm64}.node
#    argon2         → linux-{x64,arm64}/argon2.*.musl.node
#    sharp          → @img/sharp-linuxmusl-{x64,arm64}
#    node-gyp-build 在运行时按 process.arch + libc 选，装包即可用。
#
# 3. 不在镜像里放 prisma CLI（省 100M+：CLI 42M + @prisma/dev 19M +
#    @prisma/studio-core 43M + mysql2/postgres 驱动）。迁移由
#    scripts/migrate.mjs 用 better-sqlite3 直接执行，写入与 prisma
#    完全兼容的 _prisma_migrations 记录（已逐字段比对验证）。
#
# 4. 本 Dockerfile 假定**在目标架构上原生构建**（GitHub Actions 用
#    ubuntu-24.04 与 ubuntu-24.04-arm 两个原生 runner，再合并 manifest）。
#    原因：Next 的文件追踪会把原生模块 prebuild 裁剪到「构建时平台」那一个，
#    在 amd64 上构建再拿去 arm64 跑，standalone 里只有 linux-x64.node 会直接崩。
#    若非要用 buildx + QEMU 单机出多架构，next build 会慢十倍以上。

# ============================================================
# 阶段 1：依赖（含 devDependencies，next build 需要 typescript/tailwind/esbuild）
# ============================================================
FROM node:22-alpine AS deps
WORKDIR /app

# corepack 按 package.json 的 packageManager 字段锁定 pnpm 版本
RUN corepack enable

COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./

# --ignore-scripts：跳过 postinstall 编译，全走 prebuild（见要点 2）
# --frozen-lockfile：lockfile 与 package.json 不一致时失败，而不是悄悄改版本
RUN pnpm install --frozen-lockfile --ignore-scripts --node-linker=hoisted

# ============================================================
# 阶段 2：构建
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY app/ ./

# Prisma client 必须在 build 前生成，否则 @prisma/client 是空壳
RUN pnpm prisma:generate

# 把 prisma/seed-prod.ts 打包成单文件 dist/seed.mjs，
# 这样运行镜像不需要 tsx（3M + esbuild 二进制 10M）
RUN pnpm build:seed

# AUTH_SECRET 在构建期用不到真值，但 env.ts 会校验。
# 给个仅构建期有效的占位值，真值在运行时由 compose/环境注入。
ENV AUTH_SECRET="build-time-placeholder-not-a-real-secret"
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ============================================================
# 阶段 3：运行
# ============================================================
# WORKDIR 必须也是 /app，与 builder 一致。
# standalone 产物里的 .next/node_modules/<pkg>-<hash> 是指向
# 【构建时绝对路径】/app/node_modules/<pkg> 的符号链接（Turbopack 给
# serverExternalPackages 建的外部模块索引）。两阶段都用 /app 时，
# 这些链接在 runner 里恰好解到 standalone 自带的 node_modules；
# 改掉任一侧的 WORKDIR 就会断链，运行时 MODULE_NOT_FOUND。
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# 数据落在 /app/.data，由 volume 挂载（见 docker-compose.yml）
ENV DATABASE_URL="file:/app/.data/db/app.db"
ENV STORAGE_LOCAL_PATH="/app/.data/storage"

# tini 作 PID 1：Node 直接当 PID 1 收不到 SIGTERM 的默认处理，
# docker stop 会等满 10s 超时才 SIGKILL，SQLite 有被硬杀在写入中的风险。
RUN apk add --no-cache tini

# standalone 产物自带精简 node_modules（约 50M），不需要再装依赖
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# sharp 的 libvips 共享库必须手动补。
# Next 的文件追踪只跟 JS require 链，追不到原生模块 dlopen 时加载的
# 兄弟共享库（libvips-cpp.so 在独立的 @img/sharp-libvips-* 包里），
# 实测：standalone 里 @img/sharp-<plat>/lib 只有 .node 而缺 libvips，
# 启动时 worker 报 ERR_DLOPEN_FAILED —— 而 HTTP 层仍能响应、/api/health
# 也返回 200，很容易漏掉。补上整个 @img 后 worker 正常启动，
# 上传 / 缩略图 / 生成全链路跑通（本机已用 standalone 产物验证）。
# 不用 next.config 的 outputFileTracingIncludes：它在 pnpm isolated 布局下
# 会让 Turbopack 跟 .pnpm/node_modules/@img/colour 符号链接而 panic
# （详见 next.config.ts 注释）。
# 只拷当前平台的包 —— 依赖层是原生架构装的，@img 下就只有对应变体。
# 必须放在拷 standalone 之后，覆盖它那份不完整的 @img。
COPY --from=builder --chown=node:node /app/node_modules/@img ./node_modules/@img

# 迁移与 seed 所需的最小集合
COPY --from=builder --chown=node:node /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=node:node /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=node:node /app/dist/seed.mjs ./scripts/seed.mjs

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 预建数据目录并交给 node 用户。Docker 创建**具名 volume** 时会继承
# 镜像里该路径的所有权，所以容器以非 root 运行也能写入。
RUN mkdir -p /app/.data/db /app/.data/storage && chown -R node:node /app/.data

USER node
EXPOSE 3000

# 探活打到 /api/health（该路由会真查一次数据库，
# 只回 200 探不出「HTTP 活着但 DB 挂了」）。
# start-period 给 40s：首次启动要跑 migrate + seed。
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
