"use client";

import * as React from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HoverPreview } from "@/features/generation/hover-preview";
import { cn } from "@/lib/cn";
import { Trash2, Loader2, ChevronLeft, ChevronRight, HardDrive, Check } from "lucide-react";

interface AdminAssetItem {
  id: string;
  userId: string;
  objectKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  isFavorite: boolean;
  createdAt: string;
  job: { batch: { application: { name: string; slug: string } } } | null;
  user: { username: string; name: string };
}

interface OverviewRow {
  userId: string;
  username: string;
  name: string;
  role: "USER" | "ADMIN";
  assetCount: number;
  assetBytes: number;
}

interface ListResponse {
  items: AdminAssetItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  overview: {
    totalAssets: number;
    totalAssetBytes: number;
    totalUploads: number;
    totalUploadBytes: number;
    byUser: OverviewRow[];
  };
}

const PRESET_DAYS = [7, 30, 90] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 30) return `${diffDays} 天前`;
  return d.toLocaleDateString("zh-CN");
}

export default function AdminStoragePage() {
  const showToast = useToast();
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [userFilter, setUserFilter] = React.useState<string>(""); // "" = 全部
  const [olderThanDays, setOlderThanDays] = React.useState<number | null>(null);
  const [customDays, setCustomDays] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  // 实际生效的天数筛选：预设 > 自定义
  const effectiveDays = olderThanDays ?? (customDays ? Math.max(1, parseInt(customDays, 10) || 0) || null : null);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "24" });
    if (userFilter) params.set("userId", userFilter);
    if (effectiveDays) params.set("olderThanDays", String(effectiveDays));
    const res = await fetch(`/api/admin/storage?${params}`);
    const json = await res.json();
    setData(json.data);
    setLoading(false);
    // 数据回来后自动勾选当前页全部（满足“选了时间范围后全选”的需求）。
    // 放在 fetch 回调里而不是单独 effect，避免 effect 里 setState。
    if (json.data?.items?.length) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const item of json.data.items) next.add(item.id);
        return next;
      });
    }
  }

  // 切筛选条件后清空已选 + 回到第一页。fetch 走单独的 effect，
  // 清选择放交互处理函数里（不在 effect 里 setState，避免级联渲染）。
  function applyFilter(fn: () => void) {
    fn();
    setSelected(new Set());
    setPage(1);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  React.useEffect(() => { void fetchData(); }, [userFilter, olderThanDays, customDays, page]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    if (!data) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of data.items) next.add(item.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/storage", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: ids }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "删除失败");
        return;
      }
      showToast("success", `已永久删除 ${json.data.deletedCount} 项`);
      setShowDeleteConfirm(false);
      setSelected(new Set());
      await fetchData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setDeleting(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <>
      <PageHeader title="存储清理" description="管理员批量查看与删除资产（跨用户，含微调子树）" />

      {/* 存储概览 */}
      {data && (
        <section className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <HardDrive className="size-4" /> 存储概览
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">资产总数</p>
              <p className="text-lg font-semibold text-[var(--color-text)]">{data.overview.totalAssets}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">资产总占用</p>
              <p className="text-lg font-semibold text-[var(--color-text)]">{formatBytes(data.overview.totalAssetBytes)}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">上传图总数</p>
              <p className="text-lg font-semibold text-[var(--color-text)]">{data.overview.totalUploads}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">上传图总占用</p>
              <p className="text-lg font-semibold text-[var(--color-text)]">{formatBytes(data.overview.totalUploadBytes)}</p>
            </div>
          </div>

          {data.overview.byUser.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[var(--color-text-muted)]">
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-2 py-1.5 text-left font-medium">用户</th>
                    <th className="px-2 py-1.5 text-right font-medium">资产数</th>
                    <th className="px-2 py-1.5 text-right font-medium">占用</th>
                    <th className="px-2 py-1.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.overview.byUser
                    .slice()
                    .sort((a, b) => b.assetBytes - a.assetBytes)
                    .map((row) => (
                      <tr key={row.userId} className="bg-[var(--color-surface)]">
                        <td className="px-2 py-1.5 font-medium text-[var(--color-text)]">
                          {row.name}
                          <span className="ml-1 text-[var(--color-text-muted)]">@{row.username}</span>
                          {row.role === "ADMIN" && <Badge variant="info" className="ml-1">管理员</Badge>}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[var(--color-text-muted)]">{row.assetCount}</td>
                        <td className="px-2 py-1.5 text-right text-[var(--color-text-muted)]">{formatBytes(row.assetBytes)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => applyFilter(() => setUserFilter(row.userId))}
                            className="text-[var(--color-accent)] hover:underline"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 筛选条 */}
      <div className="mb-4 space-y-3">
        {/* 时间范围 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">创建于</span>
          <button
            type="button"
            onClick={() => applyFilter(() => { setOlderThanDays(null); setCustomDays(""); })}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              olderThanDays === null && !customDays
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
            )}
          >
            全部
          </button>
          {PRESET_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => applyFilter(() => { setOlderThanDays(d); setCustomDays(""); })}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                olderThanDays === d
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
              )}
            >
              {d} 天前
            </button>
          ))}
          <span className="text-xs text-[var(--color-text-muted)]">或自定义</span>
          <input
            type="number"
            min={1}
            value={customDays}
            onChange={(e) => applyFilter(() => { setCustomDays(e.target.value); setOlderThanDays(null); })}
            placeholder="天数"
            className="h-7 w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]"
          />
          <span className="text-xs text-[var(--color-text-muted)]">天前</span>
        </div>

        {/* 用户筛选 + 已选操作 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">用户</span>
            <select
              value={userFilter}
              onChange={(e) => applyFilter(() => setUserFilter(e.target.value))}
              className="h-7 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-text)]"
            >
              <option value="">全部用户</option>
              {data?.overview.byUser.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name} (@{u.username}) — {u.assetCount} 张
                </option>
              ))}
            </select>
          </div>

          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--color-text)]">
                已选 <strong className="text-[var(--color-danger)]">{selectedCount}</strong> 项
              </span>
              <Button variant="ghost" size="sm" onClick={selectAllOnPage}>全选本页</Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>清空选择</Button>
              <Button variant="danger" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="mr-1 size-4" /> 删除选中
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 加载态 */}
      {loading && (
        <div className="grid place-items-center py-12 text-[var(--color-text-muted)]">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}

      {/* 空态 */}
      {!loading && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          没有符合条件的资产
        </div>
      )}

      {/* 资产网格 */}
      {!loading && data && data.items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {data.items.map((asset) => {
            const isSelected = selected.has(asset.id);
            return (
              <div
                key={asset.id}
                className={cn(
                  "group relative overflow-hidden rounded-lg border bg-[var(--color-surface)] shadow-sm transition-colors",
                  isSelected ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30" : "border-[var(--color-border)]",
                )}
              >
                {/* 复选框 */}
                <button
                  type="button"
                  aria-label={isSelected ? "取消选择" : "选择"}
                  onClick={() => toggleSelect(asset.id)}
                  className={cn(
                    "absolute left-1.5 top-1.5 z-10 grid size-6 place-items-center rounded-full border-2 transition-colors",
                    isSelected
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                      : "border-white bg-black/40 text-transparent hover:bg-black/60",
                  )}
                >
                  <Check className="size-3.5" />
                </button>

                {/* 图片 */}
                <div className="block aspect-square w-full bg-[var(--color-surface-subtle)]">
                  <HoverPreview
                    src={`/api/storage/${encodeURIComponent(asset.thumbnailKey ?? asset.objectKey)}`}
                    fullSrc={`/api/storage/${encodeURIComponent(asset.objectKey)}`}
                    alt={asset.job?.batch.application.name ?? "资产"}
                    className="size-full"
                    imgClassName="size-full object-cover"
                  />
                </div>

                {/* 底部信息 */}
                <div className="p-2">
                  <p className="truncate text-[11px] text-[var(--color-text-muted)]">
                    {asset.job?.batch.application.name ?? "—"}
                  </p>
                  <p className="truncate text-[10px] text-[var(--color-text-muted)]">
                    {asset.user.name} · {formatDate(asset.createdAt)}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {formatBytes(asset.byteSize)}
                    {asset.isFavorite && <span className="ml-1 text-[var(--color-warning)]">★收藏</span>}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      {!loading && data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="grid size-8 place-items-center rounded-lg border border-[var(--color-border)] disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-xs text-[var(--color-text-muted)]">
            第 {page} / {data.totalPages} 页（共 {data.total} 张）
            {effectiveDays && ` · 仅显示 ${effectiveDays} 天前`}
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="grid size-8 place-items-center rounded-lg border border-[var(--color-border)] disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      {/* 删除确认。影响面可达数百项，要求逐字输入才能确认。 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title="确认批量删除"
        description={
          <>
            将永久删除 <strong className="text-[var(--color-danger)]">{selectedCount}</strong> 项资产
            （含其微调子树与文件），不可恢复。
            {effectiveDays ? ` 筛选条件：${effectiveDays} 天前。` : ""}
          </>
        }
        confirmLabel="永久删除"
        requireTypedText="删除"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
