# CanvasCommerce V2

电商商品图生成工具。上传商品图 + 选场景 → 模型出图 → 微调 / 导出长图。

**文档是唯一事实来源，动手前先读 `docs/`。** 任何 LLM 接手请先读
`AGENTS.md` → `docs/v2/00-OVERVIEW.md` → `docs/v2/10-LLM-MAINTENANCE-GUIDE.md`。

## 当前状态

V2 收敛已完成，本地可跑通全部功能；镜像已由 GitHub Actions 构建并推到 GHCR，
只剩在部署机上的容器运行时验证和一个明确延后的功能页。

最后核对：2026-08-24（以实际代码 + 实跑验证为准）。

- [x] V2 文档骨架已建好（`docs/v2/` 全套 + `docs/spec/` 从 V1 带入）
- [x] 代码迁移落实（阶段 A/B/C/D/E/G 全部完成，见 `MIGRATION-CHECKLIST.md`）
- [x] 物理清理
- [x] 整体验证：`pnpm typecheck` / `pnpm lint` 通过，单测 67 例、E2E 123 例（3 视口）全绿，
      `pnpm build` + `next start` 生产模式实跑通过
- [x] 后续优化项 OPT-1 ~ OPT-7 已落地（见 `docs/v2/11-FUTURE-OPTIMIZATIONS.md`）
- [x] 自动清理策略可在设置页配置（管理员，含"本次将删除 N 张"预览 + 二次确认）
- [x] 上传的商品图也纳入自动清理（与资产共用 30 天 / 300 张，各自独立计数）
- [ ] 管理员批量清理页（存储概览 + 按用户/时间筛选 + 手动批量删除）—— 已明确延后
- [x] 登录改用用户名（不再用邮箱，项目本身不发邮件）
- [x] Docker 部署文件已完成（`Dockerfile` / `docker-compose.yml` / `docker-entrypoint.sh` /
      GitHub Actions 多架构构建），见 `docs/v2/08-DEPLOY-DOCKER.md`
- [x] 已发布到 GitHub 公开仓库 `ibelieve3212/canvas-commerce`
- [x] GitHub Actions 首次运行通过，双架构镜像已在
      `ghcr.io/ibelieve3212/canvas-commerce:latest`（amd64 81.2MB / arm64 82.0MB）
- [ ] Docker 容器**运行时**验证（清单见上述文档第十节第二关）

待办的 P2 项（不阻塞发布）：游标分页、慢查询记录、三视口视觉回归截图对比、
资产库作为参考素材复用、自定义应用（`Application.kind = CUSTOM` 已预留数据模型）。

### 本地启动

根目录双击 `setup.bat` 完成安装与初始化，之后每次用 `start-dev.bat` 启动，
浏览器开 http://localhost:3000 。seed 账号：`admin / admin123`、`user / user123`。

详细说明（含跨平台命令、常见启动失败原因）见 `docs/v2/07-DEPLOY-LOCAL.md`。

### 图片会自动清理

生成的资产和上传的商品图默认**保留 30 天，每用户最多 300 张**（两者各自独立计数）。
超出时从最早的开始删，**收藏的图片也不例外**。删除是永久删除，没有回收站，请及时下载需要的图。

用管理员账号登录后，可在「设置 → 存储与自动清理」里改这两个数字，改完立即生效。
保存前会告诉你"本次将删除 N 张"并要求确认——请务必看清这个数字再点确定。

## 🎯 V2 一句话定位

> 把 V1 中"唯一在真正使用的那条路"确立为唯一官方部署形态，删掉所有从未实现的影子适配层，物理清理构建垃圾，让仓库可正常打开、镜像可小型化。

## ⛔ V2 不是什么

- 不是重写（不重做 UI、不改业务、不换数据层）
- 不是加功能（V2 的成功标志是代码 ≤ V1）
- 不是上多容器（明确放弃 PG/Redis/MinIO 编排）

## 🗂️ 顶层目录结构

```
canvas-commerce/
├── docs/                    # 文档（唯一事实来源，先读这里）
├── app/                     # 应用代码（完整 Next.js 项目）
├── Dockerfile               # 三阶段 alpine 构建
├── docker-compose.yml       # 单容器部署
├── docker-entrypoint.sh     # migrate → seed → 启动
├── .env.docker.example      # 部署用环境变量模板
└── .github/workflows/       # CI（检查）+ docker（多架构构建推 GHCR）
```

`app/` 内是完整 Next.js 项目，结构详见 `docs/v2/06-FILE-MAP.md`。

### Docker 部署（一句话版）

镜像由 GitHub Actions 构建双架构（amd64 + arm64）后推到 GHCR，部署机只拉不构建：

```bash
cp .env.docker.example .env    # 填 AUTH_SECRET；IMAGE 已预填 GHCR 地址
docker compose pull
docker compose up -d
```

镜像地址 `ghcr.io/ibelieve3212/canvas-commerce:latest`，
压缩体积 amd64 81.2MB / arm64 82.0MB。

完整说明、九个已知坑、验证清单见 `docs/v2/08-DEPLOY-DOCKER.md`。

## ⚙️ 技术栈（V2 收敛后）

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16 App Router + React 19 + TypeScript strict |
| 数据库 | SQLite（`better-sqlite3`）+ Prisma ORM |
| 队列 | 内存队列（`MemoryQueueAdapter`），worker 与 web 同进程 |
| 存储 | 本地文件系统（`LocalStorageAdapter`） |
| 图像处理 | sharp |
| 认证 | 自建会话 + argon2 密码哈希 |
| 校验 | Zod（env / 表单 / API 输入输出） |
| 样式 | Tailwind CSS 4 + Lucide Icons |
| 测试 | Vitest（单测）+ Playwright（E2E，3 视口） |

选型理由与"为什么删 Redis/S3"的逐项说明见 `docs/v2/04-TECH-STACK.md`。

**明确不做**：Redis、PostgreSQL/MySQL、MinIO/S3、Nginx 反代、独立 Worker 进程、PM2。
不要提议引入这些——它们在 V1 里都只是从未实现的影子适配层，V2 已删除。

## 📚 文档索引

| 文档 | 何时读 |
|---|---|
| `AGENTS.md` | 工程约束与协作规则，**动手前必读** |
| `MIGRATION-CHECKLIST.md` | V1→V2 迁移进度追踪，确认哪些已完成 |
| `docs/v2/00-OVERVIEW.md` | 文档总索引与阅读顺序 |
| `docs/v2/01-WHAT-CHANGED.md` | V1→V2 完整变更清单（每条改动 + 理由 + 风险） |
| `docs/v2/03-ARCHITECTURE.md` | 唯一架构图与各组件职责 |
| `docs/v2/05-ENV-VARS.md` | 环境变量完整清单 |
| `docs/v2/06-FILE-MAP.md` | 目录与文件结构说明 |
| `docs/v2/07-DEPLOY-LOCAL.md` | 本地开发启动方式 |
| `docs/v2/08-DEPLOY-DOCKER.md` | Docker 部署（已落实：镜像结构、九个坑、验证清单、故障排查） |
| `docs/v2/09-RISKS-AND-GOTCHAS.md` | 已知坑点、原生模块、Windows 特殊问题 |
| `docs/v2/10-LLM-MAINTENANCE-GUIDE.md` | 维护手册与禁区，**任何 LLM 接手前必读** |
| `docs/v2/11-FUTURE-OPTIMIZATIONS.md` | OPT-1~7 决策记录与落地情况 |
| `docs/spec/` | 产品/UX/设计系统/验收标准（从 V1 带入，部分条目已被 OPT 推翻，注意删除线标注） |
| `docs/_archive/` | V1 历史留档，仅供追溯 |

## 🔒 V1 保留

V1 项目在 `../dianshang/`，未做任何改动，可随时对照。V2 是独立目录，不影响 V1 运行。
