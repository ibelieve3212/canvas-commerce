# CanvasCommerce

面向电商运营的 AI 商品图生产工作台。

> **V2 说明**：本项目是 V2（收敛型），唯一部署形态为单容器单体——SQLite + 内存队列 + 本地存储 + 同进程 Worker。不使用 PostgreSQL / Redis / S3。
> 完整 V2 文档见 `../docs/`，特别是 `../docs/v2/00-OVERVIEW.md`。

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 11+
- SQLite（开发数据库，随 `better-sqlite3` 内置，无需安装外部服务）
- ⚠️ **项目根目录路径不能含中文**，否则 pnpm 符号链接失效、Turbopack/webpack 编译异常。

### 安装

```bash
pnpm install
```

> **Windows 原生模块**：`better-sqlite3` 编译需要 Visual Studio Build Tools。若本机未装且 pnpm store 有预编译二进制，可用 `pnpm install --offline --ignore-scripts` 跳过编译。

### 配置环境变量

复制 `.env.example` 为 `.env` 并修改 `AUTH_SECRET`：

```env
AUTH_SECRET=your-random-secret-at-least-16-chars
DATABASE_URL=file:.data/db/dev.db
STORAGE_LOCAL_PATH=.data/storage
GENERATION_PROVIDER=mock
```

> V2 环境变量完整清单见 `../docs/v2/05-ENV-VARS.md`。

### 初始化数据库

```bash
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed
```

Seed 会创建：
- admin / admin123（管理员）
- user / user123（普通用户）
- 4 个内置应用 + 默认配额

### 启动开发服务器

```bash
pnpm dev
# 或指定端口
npx next dev --webpack -p 30143
```

> ⚠️ **必须用 `--webpack` 模式**。Next.js 16 默认使用 Turbopack，但在含原生模块（`better-sqlite3`）的路由上会编译死锁。`--webpack` 模式下 `serverExternalPackages` 正确生效，不会卡死。

访问 `http://localhost:3000`（或自定义端口），使用 seed 账号登录。

### Worker 说明

Worker 与 Next.js 同进程运行，由 `src/instrumentation.ts` 在进程启动时拉起——
**dev 和生产都启动**。V2 不需要独立 worker 进程，也没有 `pnpm worker` 脚本。

Worker 做两件事：
1. 队列轮询，处理生图 Job（内存队列，`onEnqueue` 唤醒 + 每 3 秒兜底轮询）
2. 自动清理 tick：启动 2 分钟后跑第一次，之后每 6 小时一次

`src/server/worker/index.ts` 只导出 `startWorker()` / `runCleanupTick()`，不自己执行。
改动这里时注意 `instrumentation.ts` 用 `new Function` + `createRequire` 隔离了导入链，
目的是阻止 webpack 静态分析到 better-sqlite3 等原生模块——不要"顺手简化"成普通 import。

### 自动清理

资产（含微调图）和上传图共用一对阈值，但各自独立计数；**收藏图不豁免**。
删除是物理删除（删文件 + 删记录 + 递归删微调子树），不可恢复，无回收站。

阈值优先级：**设置页（SystemSetting）> `.env`**。管理员在设置页的"存储与自动清理"区块修改，
每次 tick 现读，改完即时生效、无需重启容器。`.env` 里的 `ASSET_RETENTION_DAYS`、
`MAX_ASSETS_PER_USER` 只在数据库无配置时作兜底（如全新部署）。

保存设置时会先算出"本次将删除 N 张"并要求二次确认——这是防手滑的关键，
因为一个输入框直接控制不可恢复的批量删除。下界限制：天数 ≥ 1、数量 ≥ 10。

聊天会话保留期（`CHAT_RETENTION_DAYS`，默认 30 天）独立于资产，只能改 `.env`。

### 原生模块说明

- `better-sqlite3@13.0.3` 通过 `pnpm-workspace.yaml` 的 `overrides` 锁定版本，避免与 `@prisma/adapter-better-sqlite3` 间接依赖的 `@12.x` 冲突。
- 本机无 Visual Studio C++ 工具链时，用 `pnpm install --offline --ignore-scripts` 保留 pnpm store 中的预编译二进制，不要重新编译。
- 因此 `pnpm-workspace.yaml` 里设了 `verifyDepsBeforeRun: false`。pnpm 11 默认在跑脚本前校验依赖，
  会把 `--ignore-scripts` 装出来的 node_modules 判为不完整并自动触发 `pnpm install`，
  进而 node-gyp 编译 better-sqlite3 失败，`start-dev.bat` 起不来。这个配置项在 pnpm 11 里已从 `.npmrc` 迁到本文件。
- `next.config.ts` 的 `serverExternalPackages` 已配置 `better-sqlite3`、`@prisma/client`、`@prisma/adapter-better-sqlite3`、`argon2`、`sharp`、`detect-libc`，webpack 不编译它们。

### 运行测试

```bash
pnpm test          # 单元测试（vitest，9 文件 / 67 例）
pnpm test:e2e      # E2E（Playwright，14 文件 / 41 例 × 3 视口 = 123）
pnpm typecheck     # TypeScript 类型检查
pnpm lint          # ESLint
```

E2E 说明：
- `playwright.config.ts` 固定 `workers: 1` + `fullyParallel: false`。全部用例共用同一个 SQLite 库
  和同一对 seed 账号，`user-mgmt` 会停用/重置密码、`admin-apps` 会下架应用，并行跑会互相干扰出假失败。
- test timeout 为 180s（用例内部 expect timeout 最大 120s，test timeout 必须更大，否则永远先超时）。
- 需要 dev server 已在 3000 端口运行（config 里 `reuseExistingServer: true`），
  且当前账号未配置真实 Provider（见下方 Provider 配置）。

## 项目结构

```
src/
  app/                    # Next.js App Router
    (app)/                # 登录后工作台
      apps/               # 应用中心 + 生成器
      tasks/              # 任务中心
      assets/             # 资产库
      chat/               # AI 聊天助手
      settings/           # 设置（密码/配额/Provider/Chat 渠道）
      admin/              # 管理员（用户管理 / 应用管理）
    api/                  # API 路由
    login/                # 登录页
  components/             # 基础 UI 组件
  contracts/              # Zod 契约定义
  features/               # 业务功能模块
  server/                 # 服务端逻辑
    applications/         # 应用定义
    auth/                 # 鉴权 + 限流
    chat/                 # 聊天服务（SSE 流式 + 滑动窗口 + vision）
    db/                   # Prisma 客户端
    export/               # 导出服务（ZIP/长图）
    generation/           # Batch/Job 服务 + 微调（tweak.ts）
    provider/             # 生图 Provider（Mock/CCLOAD）
    queue/                # 队列适配器（内存队列，唯一形态）
    storage/              # 存储适配器（本地文件，唯一形态）
    worker/               # Worker loop（同进程）+ 每 6 小时清理 tick
prisma/                   # Prisma schema + 迁移 + seed
tests/                    # 测试
```

## 内置应用

| 应用 | 路由 | 说明 |
|------|------|------|
| 商品主图 | `/apps/main-image` | 1/3/5 张，文字由模型直出，可微调 |
| AI 详情页 | `/apps/detail-page` | 6 张详情页模块 |
| 买家秀 | `/apps/buyer-show` | 1/2/4 张 |
| 营销海报 | `/apps/poster` | 1/2/4/6 张 |

生成结果可点"微调"用自然语言调整（调 `/v1/images/edits`，最多 3 轮，每轮扣 1 配额）。
系统文字层（SVG 合成）已删除，不要试图恢复。

## Provider 配置

### Mock Provider（默认）

无需外部 API，生成确定性占位 PNG，适合开发测试。

### CCLOAD New API

设置 `GENERATION_PROVIDER=newapi` 并配置：
- `CCLOAD_NEW_API_BASE_URL` — API 根地址
- `CCLOAD_NEW_API_TOKEN` — Bearer Token
- `CCLOAD_IMAGE_MODEL` — 模型名（默认 `gpt-image-2`）

也可以不用 env：在设置页按用户配置（优先级 用户级 > 管理员默认 SystemSetting > env > Mock）。
聊天渠道同理，仅在设置页配置，可勾"沿用图像渠道"。

> 跑 E2E 前请确认当前账号**没有**配置真实 Provider，否则会走真实 API + 5 RPM 节流，
> 生成类用例必然超时。E2E 依赖 Mock Provider。

## 技术栈

- Next.js 16 (App Router) + React 19
- TypeScript (strict mode)
- Tailwind CSS 4
- Prisma 7 (SQLite，唯一数据库)
- 内存队列（唯一队列形态）
- 本地文件存储（唯一存储形态）
- sharp (图片处理)
- argon2 (密码哈希)
- Vitest + Playwright (测试)

## 构建与部署

### 生产构建

```bash
pnpm prisma:generate     # 必须在 build 前，否则 @prisma/client 是空壳
pnpm build:seed          # esbuild 打包生产 seed → dist/seed.mjs
pnpm build               # 产出 .next/standalone
```

`next.config.ts` 里 `output: "standalone"`，入口是 `.next/standalone/server.js`
（不是 `next start`）。产物自带精简 node_modules（约 31M）。

### 数据库迁移

```bash
pnpm prisma:migrate      # 开发：改 schema 后生成 migration
pnpm db:migrate          # 生产：自写 runner 直接执行 SQL（不需要 prisma CLI）
```

⚠️ 新增 migration **必须是纯 SQL**，生成后要跑一遍 `pnpm db:migrate` 确认
自写 runner 能执行。原因见 `../docs/v2/09-RISKS-AND-GOTCHAS.md` 第 14 条。

### Docker 部署

部署文件在**仓库根目录**（不在 `app/` 下）。镜像由 GitHub Actions 构建，
部署机只拉不构建：

```bash
cd ..
cp .env.docker.example .env    # 填 AUTH_SECRET 与 IMAGE
docker compose pull
docker compose up -d
```

完整说明见 `../docs/v2/08-DEPLOY-DOCKER.md`。**改 Dockerfile 前必读该文档
第四节「九个坑」** —— hoisted linker、两阶段 WORKDIR 必须一致、
sharp 的 libvips 要手动 COPY 等，凭直觉简化必坏。
