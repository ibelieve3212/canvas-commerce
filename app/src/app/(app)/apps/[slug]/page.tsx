import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { GeneratorClient } from "@/features/generation/generator-client";
import { getApplication } from "@/server/applications/service";

// 这个路由必然是动态的：父级 (app)/layout.tsx 调 getCurrentUser() 读 cookie，
// 每个请求都要鉴权，永远不可能被静态预渲染（构建产物里标记就是 ƒ）。
//
// 曾经这里有 generateStaticParams() 列出四个 slug。它不会让页面变成静态，
// 却会让 `next build` 在 "Generating static pages" 阶段尝试预渲染这四条路径，
// 进而调 getApplication() 连数据库。构建环境（尤其 Docker builder 阶段）
// 没有 .data/db 目录，日志会刷一屏
// `prisma:error Cannot open database because the directory does not exist`。
// 构建不会失败，但错误噪音会掩盖真正的问题。所以故意不写 generateStaticParams。

export default async function AppGeneratorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const app = await getApplication(slug);
  if (!app) notFound();

  return (
    <>
      <PageHeader title={app.name} description={app.description} />
      <GeneratorClient app={app} />
    </>
  );
}
