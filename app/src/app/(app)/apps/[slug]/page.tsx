import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { GeneratorClient } from "@/features/generation/generator-client";
import { getApplication } from "@/server/applications/service";

export function generateStaticParams() {
  return [
    { slug: "main-image" },
    { slug: "detail-page" },
    { slug: "buyer-show" },
    { slug: "poster" },
  ];
}

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
