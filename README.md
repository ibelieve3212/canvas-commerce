# CanvasCommerce

电商商品图生成工具。上传商品图 + 选场景 → 模型出图 → 微调 / 导出长图。

## 当前状态

本地可跑通全部功能；镜像已由 GitHub Actions 构建并推到 GHCR，
只剩在部署机上的容器运行时验证和一个明确延后的功能页。

最后核对：2026-08-24（以实际代码 + 实跑验证为准）。

- [x] 整体验证：`pnpm typecheck` / `pnpm lint` 通过，单测 67 例、E2E 123 例（3 视口）全绿，
      `pnpm build` + `next start` 生产模式实跑通过
- [x] 自动清理策略可在设置页配置（管理员，含"本次将删除 N 张"预览 + 二次确认）
- [x] 上传的商品图也纳入自动清理（与资产共用 30 天 / 300 张，各自独立计数）
- [ ] 管理员批量清理页（存储概览 + 按用户/时间筛选 + 手动批量删除）—— 已明确延后
- [x] 登录改用用户名（不再用邮箱，项目本身不发邮件）
- [x] Docker 部署文件已完成（`Dockerfile` / `docker-compose.yml` / `docker-entrypoint.sh` /
      GitHub Actions 多架构构建）
- [x] 已发布到 GitHub 公开仓库 `ibelieve3212/canvas-commerce`
- [x] GitHub Actions 首次运行通过，双架构镜像已在
      `ghcr.io/ibelieve3212/canvas-commerce:latest`（amd64 81.2MB / arm64 82.0MB）
- [ ] Docker 容器**运行时**验证

待办的 P2 项（不阻塞发布）：游标分页、慢查询记录、三视口视觉回归截图对比、
资产库作为参考素材复用、自定义应用（`Application.kind = CUSTOM` 已预留数据模型）。

### 本地启动

开发环境需要 Node.js 22+ 和 pnpm 11+。在 `app/` 目录下：

```bash
cd app
pnpm install
pnpm prisma:generate
pnpm db:migrate          # 初始化本地 SQLite 数据库
pnpm seed                 # 填充开发用数据（内置应用 + 测试账号）
pnpm dev                 # 启动开发服务器
```

浏览器开 http://localhost:3000 。默认账号 `admin / admin123`，**登录后立刻改密码**。

### 图片会自动清理

生成的资产和上传的商品图默认**保留 30 天，每用户最多 300 张**（两者各自独立计数）。
超出时从最早的开始删，**收藏的图片也不例外**。删除是永久删除，没有回收站，请及时下载需要的图。

用管理员账号登录后，可在「设置 → 存储与自动清理」里改这两个数字，改完立即生效。
保存前会告诉你"本次将删除 N 张"并要求确认——请务必看清这个数字再点确定。

## 🗂️ 顶层目录结构

```
canvas-commerce/
├── app/                     # 应用代码（完整 Next.js 项目）
├── Dockerfile               # 三阶段 alpine 构建
├── docker-compose.yml       # 单容器部署
├── docker-entrypoint.sh     # migrate → seed → 启动
├── .env.docker.example      # 部署用环境变量模板
└── .github/workflows/       # CI（检查）+ docker（多架构构建推 GHCR）
```

`app/` 内是完整 Next.js 项目，`app/README.md` 有详细的项目结构和开发说明。

### Docker 部署

镜像由 GitHub Actions 构建双架构（amd64 + arm64）后推到 GHCR，部署机只拉不构建。
镜像地址 `ghcr.io/ibelieve3212/canvas-commerce:latest`，压缩体积 amd64 81.2MB / arm64 82.0MB。

**方式一：`docker run`**

只需一项必填：`AUTH_SECRET`（会话 cookie 签名密钥）。下面用 `openssl` 生成一个
并直接在同一个 shell 里启动：

```bash
# 拉镜像
docker pull ghcr.io/ibelieve3212/canvas-commerce:latest

# 生成密钥（只在当前 shell 会话里生效，下面那行命令会引用它）
AUTH_SECRET=$(openssl rand -base64 32)

# 启动
docker run -d \
  --name canvas-commerce \
  --restart unless-stopped \
  -p 3000:3000 \
  -e AUTH_SECRET="$AUTH_SECRET" \
  -v canvas-data:/app/.data \
  ghcr.io/ibelieve3212/canvas-commerce:latest
```

首次启动会自动建库、跑 migration、创建管理员（`admin / admin123`），
看到 `[entrypoint] 就绪` 与 `[worker] 启动` 即成功。**登录后立刻改密码。**

> 关于 `AUTH_SECRET`：上面把它存进了 shell 变量供下一条命令引用。
> 如果你不在同一个 shell 里连续跑（比如手动拼命令），把 `$AUTH_SECRET` 换成
> 你生成的那个字符串即可，例如 `-e AUTH_SECRET="PtgM...igw="`。
> 更新镜像重新 `docker run` 时**要用同一个值**，否则旧会话全部失效。

**数据存在哪**：上面的 `-v canvas-data:/app/.data` 用的是 Docker 具名 volume，
数据库和用户图片都存在里面。这是推荐做法——容器内以非 root 用户运行，
具名 volume 能自动处理权限。如果想把数据放到指定路径（方便直接备份/管理），
把 `-v canvas-data:/app/.data` 换成绑定挂载：

```bash
mkdir -p /你的路径                    # 先建好目录
chown -R 1000:1000 /你的路径           # 容器内 node 用户 uid 是 1000
# 启动时把 -v 换成：
#   -v /你的路径:/app/.data
```

⚠️ 绑定挂载必须先 `chown 1000:1000`，否则容器内写不进去（报 `Permission denied`）。

其余可选项：
- 只绑本机访问（不对外暴露）：把 `-p 3000:3000` 改成 `-p 127.0.0.1:3000:3000`
- 2GB 内存小机器加 `--memory=1500m`
- 其他环境变量（Provider、配额、清理策略等）用 `-e KEY=VALUE` 传，全部变量见 `.env.docker.example`

更新到新版本：

```bash
docker pull ghcr.io/ibelieve3212/canvas-commerce:latest
docker rm -f canvas-commerce        # 数据在 volume 里，不受影响
# 重新执行上面的 docker run（AUTH_SECRET 要用同一个值）
```

**方式二：`docker compose`**

```bash
cp .env.docker.example .env    # 填 AUTH_SECRET；IMAGE 已预填 GHCR 地址
docker compose pull
docker compose up -d
```

两种方式等效。全部环境变量见 `.env.docker.example`。

## ⚙️ 技术栈

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

**明确不做**：Redis、PostgreSQL/MySQL、MinIO/S3、Nginx 反代、独立 Worker 进程、PM2。
不要提议引入这些。
