"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Star, Trash2, Loader2, ChevronLeft, ChevronRight, X, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import { HoverPreview } from "@/features/generation/hover-preview";

interface AssetJob {
  id: string;
  batchId: string;
  outputIndex: number;
  outputRole: string;
  batch: { applicationId: string; application: { name: string; slug: string } };
}

interface AssetItem {
  id: string;
  objectKey: string;
  thumbnailKey: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  isFavorite: boolean;
  createdAt: string;
  job: AssetJob | null;
  /** 微调后代数量，删除确认要提示会连带删掉几张 */
  descendantCount: number;
}

interface AssetListResponse {
  items: AssetItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 当前生效的清理阈值（管理员可在设置页调整，故不在前端硬编码） */
  policy?: { retentionDays: number; maxItemsPerUser: number };
}

export function AssetsBrowser() {
  const showToast = useToast();
  const [data, setData] = React.useState<AssetListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [favoriteOnly, setFavoriteOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [previewAsset, setPreviewAsset] = React.useState<AssetItem | null>(null);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<AssetItem | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "24" });
    if (favoriteOnly) params.set("favorite", "true");
    const res = await fetch(`/api/assets?${params}`);
    const json = await res.json();
    setData(json.data);
    setLoading(false);
  }, [page, favoriteOnly]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { fetchData(); }, [fetchData]);

  async function handleFavorite(assetId: string) {
    setActionLoading(`fav-${assetId}`);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "favorite" }),
      });
      const json = await res.json();
      if (!res.ok) { showToast("error", json.error?.message || "操作失败"); return; }
      fetchData();
    } catch { showToast("error", "网络错误"); }
    finally { setActionLoading(null); }
  }

  async function handleDelete() {
    const asset = pendingDelete;
    if (!asset) return;
    setActionLoading(`del-${asset.id}`);
    try {
      const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { showToast("error", json.error?.message || "删除失败"); return; }
      showToast("success", `已永久删除 ${json.data.deletedCount} 张图片`);
      setPendingDelete(null);
      fetchData();
    } catch { showToast("error", "网络错误"); }
    finally { setActionLoading(null); }
  }

  return (
    <div className="space-y-4">
      {/* 筛选 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setFavoriteOnly(false); setPage(1); }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            !favoriteOnly
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
          )}
        >
          全部图片
        </button>
        <button
          type="button"
          onClick={() => { setFavoriteOnly(true); setPage(1); }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            favoriteOnly
              ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
          )}
        >
          <Star className={cn("size-3.5", favoriteOnly && "fill-current")} />
          已收藏
        </button>
      </div>

      {/* 资产库容量提示（OPT-2）。阈值来自接口，随管理员设置变化 */}
      {!loading && data && (
        (() => {
          const count = data.total;
          const max = data.policy?.maxItemsPerUser ?? 300;
          const days = data.policy?.retentionDays ?? 30;
          // 达 90% 时变色预警
          const nearLimit = count >= Math.floor(max * 0.9);
          return (
            <div
              className={cn(
                "rounded-lg px-3 py-2 text-xs",
                nearLimit
                  ? "border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                  : "border border-[var(--color-border)] bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]",
              )}
            >
              {nearLimit
                ? `⚠️ 您的资产库即将达上限（${count}/${max}），超出后最早的资产将自动清理。请及时下载需要的图片。`
                : `您的资产库已使用 ${count} / ${max} 张，资源保留 ${days} 天（含收藏图片），请及时下载保存。`}
            </div>
          );
        })()
      )}

      {/* 加载态 */}
      {loading && <div className="grid place-items-center py-12 text-[var(--color-text-muted)]"><Loader2 className="size-6 animate-spin" /></div>}

      {/* 空态 */}
      {!loading && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          {favoriteOnly ? "暂无收藏图片" : "暂无生成图片"}
        </div>
      )}

      {/* 资产网格 */}
      {!loading && data && data.items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {data.items.map((asset) => (
            <div key={asset.id} className="group relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
              {/* 图片 */}
              <div
                className="block aspect-square w-full bg-[var(--color-surface-subtle)]"
                onClick={() => setPreviewAsset(asset)}
                style={{ cursor: "pointer" }}
              >
                <HoverPreview
                  src={`/api/storage/${encodeURIComponent(asset.thumbnailKey ?? asset.objectKey)}`}
                  fullSrc={`/api/storage/${encodeURIComponent(asset.objectKey)}`}
                  alt={asset.job?.outputRole ?? "生成图片"}
                  className="size-full"
                  imgClassName="size-full object-cover transition-transform group-hover:scale-105"
                />
              </div>

              {/* 悬浮操作 */}
              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  disabled={actionLoading === `fav-${asset.id}`}
                  onClick={() => handleFavorite(asset.id)}
                  className={cn(
                    "grid size-7 place-items-center rounded-full backdrop-blur",
                    asset.isFavorite ? "bg-[var(--color-accent)] text-white" : "bg-black/50 text-white",
                  )}
                >
                  <Star className={cn("size-3.5", asset.isFavorite && "fill-current")} />
                </button>
                <button
                  type="button"
                  aria-label="删除图片"
                  disabled={actionLoading === `del-${asset.id}`}
                  onClick={() => setPendingDelete(asset)}
                  className="grid size-7 place-items-center rounded-full bg-black/50 text-white hover:bg-[var(--color-danger)]"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* 收藏指示器（常显） */}
              {asset.isFavorite && (
                <div className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--color-accent)] text-white">
                  <Star className="size-3 fill-current" />
                </div>
              )}

              {/* 底部信息 */}
              <div className="p-2">
                <p className="truncate text-[11px] text-[var(--color-text-muted)]">
                  {asset.job?.batch.application.name ?? "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {!loading && data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
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

      {/* 预览弹窗 */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-3xl overflow-hidden rounded-xl bg-[var(--color-surface)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setPreviewAsset(null)}
              className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <X className="size-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/storage/${encodeURIComponent(previewAsset.objectKey)}`}
              alt={previewAsset.job?.outputRole ?? "预览"}
              className="max-h-[80vh] w-full object-contain"
            />
            <div className="flex items-center justify-between p-3">
              <div className="text-xs text-[var(--color-text-muted)]">
                {previewAsset.job?.batch.application.name} · {previewAsset.job?.outputRole}
                {previewAsset.width && ` · ${previewAsset.width}×${previewAsset.height}`}
              </div>
              <a
                href={`/api/storage/${encodeURIComponent(previewAsset.objectKey)}`}
                download
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
              >
                <Download className="size-3.5" /> 下载
              </a>
            </div>
          </div>
        </div>
      )}
      {/* 删除确认。有微调子图时明确提示会连带删几张（OPT-2 第一节的两种提示语） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="确认删除图片"
        description={
          pendingDelete && pendingDelete.descendantCount > 0 ? (
            <>
              该图有 <strong className="text-[var(--color-danger)]">{pendingDelete.descendantCount}</strong> 张微调版本，
              将一并永久删除（共 {pendingDelete.descendantCount + 1} 张），且不可恢复。
            </>
          ) : (
            "该操作不可恢复，文件将从服务器永久删除。"
          )
        }
        confirmLabel="永久删除"
        loading={actionLoading === `del-${pendingDelete?.id}`}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
