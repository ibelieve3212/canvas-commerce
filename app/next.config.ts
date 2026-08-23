import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署用 standalone：产物自带精简 node_modules，镜像不需要装全量依赖。
  // 注意产物布局与 `next start` 不同（入口是 .next/standalone/server.js），
  // instrumentation 里 worker 的 require 路径依赖这一点，详见 src/instrumentation.ts。
  output: "standalone",
  // dev 工具指示器默认在左下角，会盖在移动视口（390）的底部导航上，
  // 导致 <nextjs-portal> 拦下点击事件，E2E 点不到底态的"任务"。指示器只存在于 dev。
  devIndicators: { position: "top-right" },
  // 注意：这里故意**不用** outputFileTracingIncludes 来补 sharp 的 libvips。
  // 它确实能把 @img/sharp-libvips-* 拉进产物，但在 Windows + pnpm isolated
  // 布局下会让 Turbopack 去跟 .pnpm/node_modules/@img/colour 这个符号链接，
  // 直接 panic（os error 5 拒绝访问），本地 pnpm build 全挂。
  // 改成在 Dockerfile 里显式 COPY node_modules/@img，行为确定且跟平台无关。
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "argon2",
    "sharp",
    "detect-libc",
  ],
};

export default nextConfig;
