#!/bin/sh
# 容器启动流程：迁移 → seed → 交给主进程。
#
# 任一步失败就退出，不带着半迁移的库启动服务。
set -eu

echo "[entrypoint] CanvasCommerce 启动中…"

# ---- 必填项检查 ----
# AUTH_SECRET 决定会话 cookie 的签名。没有它 env.ts 会在启动时抛错，
# 但那个报错在一堆 Next 日志里不显眼，这里提前拦住并给明确指引。
if [ -z "${AUTH_SECRET:-}" ]; then
  echo "[entrypoint] 错误：必须设置 AUTH_SECRET（至少 16 字符）" >&2
  echo "[entrypoint] 生成一个：openssl rand -base64 32" >&2
  exit 1
fi

# ---- 数据目录 ----
# volume 首次挂载时可能是空目录，migrate 前先确保结构存在。
mkdir -p /app/.data/db /app/.data/storage

# ---- 数据库迁移 ----
# 幂等：已应用的跳过。检测到 migration 文件被改过、或库里有本镜像
# 不认识的 migration（镜像被回滚到旧版本）会中止并说明原因。
echo "[entrypoint] 执行数据库迁移…"
MIGRATIONS_DIR=/app/prisma/migrations node /app/scripts/migrate.mjs

# ---- seed ----
# 每次启动都跑，但是幂等的：
#   内置应用   → upsert（新版镜像可能改了 promptTemplate 或加了应用）
#   管理员账号 → 只在「库里没有任何 ADMIN」时创建，绝不重置已有密码
echo "[entrypoint] 同步内置数据…"
node /app/scripts/seed.mjs

echo "[entrypoint] 就绪，启动应用"
exec "$@"
