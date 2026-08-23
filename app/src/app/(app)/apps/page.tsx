import { Suspense } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { ApplicationsBrowser } from "@/features/applications/applications-browser";
import { listPublishedApplications } from "@/server/applications/service";

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
