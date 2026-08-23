import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ApplicationsBrowser } from "@/features/applications/applications-browser";
import { listPublishedApplications } from "@/server/applications/service";

// 强制动态渲染。父级 (app)/layout.tsx 读 cookie 鉴权，这个页面本就不可能静态化
// （产物里标记是 ƒ）。但不加这行的话，`next build` 的 "Generating static pages"
// 阶段仍会尝试渲染一次以探测动态用法，期间会调 listPublishedApplications() 连库。
// 构建环境（尤其 Docker builder 阶段）没有 .data/db 目录，日志就多一条
// `prisma:error Cannot open database because the directory does not exist`。
// 查询本身有 try/catch 回落到内置应用，功能不受影响，但错误噪音会掩盖真问题。
export const dynamic = "force-dynamic";

export default async function AppsPage() {
  const apps = await listPublishedApplications();

  return (
    <>
      <PageHeader
        title="应用中心"
        description="选择一个电商应用开始创作"
      />
      <Suspense fallback={<div className="text-sm text-[var(--color-text-muted)]">加载中…</div>}>
        <ApplicationsBrowser apps={apps} />
      </Suspense>
    </>
  );
}
