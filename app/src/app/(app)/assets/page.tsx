import { PageHeader } from "@/components/shell/page-header";
import { AssetsBrowser } from "@/features/assets/assets-browser";

export default function AssetsPage() {
  return (
    <>
      <PageHeader title="资产库" description="按批次或单图管理生成结果" />
      <AssetsBrowser />
    </>
  );
}
