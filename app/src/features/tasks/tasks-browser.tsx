"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Ban, Trash2, Repeat, Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { HoverPreview } from "@/features/generation/hover-preview";

interface BatchJob {
  id: string;
  outputIndex: number;
  outputRole: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  asset: { id: string; objectKey: string; thumbnailKey: string | null } | null;
}

interface BatchItem {
  id: string;
  status: string;
  applicationId: string;
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  canceledCount: number;
  aspectRatio: string;
  createdAt: string;
  parentBatchId: string | null;
  application: { name: string; slug: string; emojiIcon: string | null };
  jobs: BatchJob[];
  childBatches: { id: string; createdAt: string; status: string }[];
}

interface BatchListResponse {
  items: BatchItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  partial: "部分完成",
  completed: "已完成",
  failed: "已失败",
  canceled: "已取消",
};

const STATUS_VARIANT: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  queued: "neutral",
  running: "warning",
  partial: "warning",
  completed: "success",
  failed: "danger",
  canceled: "neutral",
};

export function TasksBrowser() {
  const router = useRouter();
  const showToast = useToast();
  const [data, setData] = React.useState<BatchListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [expandedBatch, setExpandedBatch] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [pendingCancel, setPendingCancel] = React.useState<BatchItem | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<BatchItem | null>(null);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "12" });
    if (statusFilter !== "all") params.set("status", statusFilter);
    const res = await fetch(`/api/batches?${params}`);
    const json = await res.json();
    setData(json.data);
    setLoading(false);
  }, [page, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { fetchData(); }, [fetchData]);

  async function handleCancel() {
    const batch = pendingCancel;
    if (!batch) return;
    setActionLoading(`cancel-${batch.id}`);
    try {
      const res = await fetch(`/api/batches/${batch.id}`, { method: "PATCH" });
      const json = await res.json();
      if (!res.ok) { showToast("error", json.error?.message || "取消失败"); return; }
      showToast("success", "批次已取消");
      setPendingCancel(null);
      fetchData();
    } catch { showToast("error", "网络错误"); }
    finally { setActionLoading(null); }
  }

  async function handleDelete() {
    const batch = pendingDelete;
    if (!batch) return;
    setActionLoading(`delete-${batch.id}`);
    try {
      const res = await fetch(`/api/batches/${batch.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) { showToast("error", json.error?.message || "删除失败"); return; }
      showToast("success", "批次已永久删除");
      setPendingDelete(null);
      fetchData();
    } catch { showToast("error", "网络错误"); }
    finally { setActionLoading(null); }
  }

  async function handleReuse(batchId: string, slug: string) {
    setActionLoading(`reuse-${batchId}`);
    // 跳转到生成器页面并带上 fromBatch 参数，恢复表单供用户微调
    router.push(`/apps/${slug}?fromBatch=${batchId}`);
    setActionLoading(null);
  }

  const statusOptions = [
    { value: "all", label: "全部" },
    { value: "completed", label: "已完成" },
    { value: "running", label: "生成中" },
    { value: "partial", label: "部分完成" },
    { value: "failed", label: "失败" },
    { value: "canceled", label: "已取消" },
  ];

  return (
    <div className="space-y-4">
      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        {statusOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => { setStatusFilter(opt.value); setPage(1); }}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              statusFilter === opt.value
                ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 加载态 */}
      {loading && <div className="grid place-items-center py-12 text-[var(--color-text-muted)]"><Loader2 className="size-6 animate-spin" /></div>}

      {/* 空态 */}
      {!loading && data && data.items.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          暂无生成任务
        </div>
      )}

      {/* 批次列表 */}
      {!loading && data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((batch) => (
            <div key={batch.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{batch.application.emojiIcon || "🧩"}</span>
                    <Link href={`/apps/${batch.application.slug}`} className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]">
                      {batch.application.name}
                    </Link>
                    <Badge variant={STATUS_VARIANT[batch.status] ?? "neutral"}>
                      {STATUS_LABEL[batch.status] ?? batch.status}
                    </Badge>
                    {batch.childBatches.length > 0 && (
                      <span className="rounded bg-[var(--color-info)]/8 px-1.5 py-0.5 text-[10px] text-[var(--color-info)]">{batch.childBatches.length} 次复用</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {new Date(batch.createdAt).toLocaleString("zh-CN")} · {batch.aspectRatio} · {batch.succeededCount}/{batch.requestedCount} 成功
                    {batch.failedCount > 0 && ` · ${batch.failedCount} 失败`}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  {/* 展开技术错误 */}
                  {batch.jobs.some((j) => j.errorCode) && (
                    <Tooltip content="技术错误详情">
                      <button
                        type="button"
                        aria-label="技术错误详情"
                        onClick={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)}
                        className={cn(
                          "grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]",
                          expandedBatch === batch.id && "bg-[var(--color-surface-subtle)] text-[var(--color-text)]",
                        )}
                      >
                        <Repeat className="size-4" />
                      </button>
                    </Tooltip>
                  )}

                  {(batch.status === "queued" || batch.status === "running" || batch.status === "partial") && (
                    <Tooltip content="取消">
                      <button
                        type="button"
                        aria-label="取消批次"
                        disabled={actionLoading === `cancel-${batch.id}`}
                        onClick={() => setPendingCancel(batch)}
                        className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
                      >
                        {actionLoading === `cancel-${batch.id}` ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                      </button>
                    </Tooltip>
                  )}

                  <Tooltip content="恢复配置">
                    <button
                      type="button"
                      aria-label="恢复配置"
                      disabled={actionLoading === `reuse-${batch.id}`}
                      onClick={() => handleReuse(batch.id, batch.application.slug)}
                      className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                    >
                      {actionLoading === `reuse-${batch.id}` ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                    </button>
                  </Tooltip>

                  <Tooltip content="删除">
                    <button
                      type="button"
                      aria-label="删除批次"
                      disabled={actionLoading === `delete-${batch.id}`}
                      onClick={() => setPendingDelete(batch)}
                      className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-danger)]"
                    >
                      {actionLoading === `delete-${batch.id}` ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* 缩略图预览 */}
              {batch.jobs.some((j) => j.asset) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {batch.jobs.filter((j) => j.asset).map((job) => {
                    const fullUrl = `/api/storage/${encodeURIComponent(job.asset!.objectKey)}`;
                    const thumbUrl = `/api/storage/${encodeURIComponent(job.asset!.thumbnailKey ?? job.asset!.objectKey)}`;
                    return (
                      <HoverPreview
                        key={job.id}
                        src={thumbUrl}
                        fullSrc={fullUrl}
                        alt={job.outputRole}
                        className="size-16 overflow-hidden rounded border border-[var(--color-border)]"
                        imgClassName="size-full object-cover"
                      />
                    );
                  })}
                </div>
              )}

              {/* 展开技术错误 */}
              {expandedBatch === batch.id && (
                <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3">
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">技术错误详情</p>
                  {batch.jobs.filter((j) => j.errorCode || j.errorMessage).map((job) => (
                    <div key={job.id} className="text-xs">
                      <span className="font-mono text-[var(--color-danger)]">{job.errorCode}</span>
                      <span className="ml-2 text-[var(--color-text-muted)]">{job.errorMessage}</span>
                      <span className="ml-2 text-[var(--color-text-muted)]">(角色: {job.outputRole}, 尝试: {job.attempt})</span>
                    </div>
                  ))}
                </div>
              )}
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
            第 {page} / {data.totalPages} 页（共 {data.total} 个）
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

      <ConfirmDialog
        open={pendingCancel !== null}
        title="确认取消批次"
        description="取消后未完成的任务将停止生成。已生成的图片保留。"
        confirmLabel="取消批次"
        cancelLabel="返回"
        loading={actionLoading === `cancel-${pendingCancel?.id}`}
        onConfirm={handleCancel}
        onCancel={() => setPendingCancel(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="确认删除任务"
        description="该任务下所有图片（含微调版本）的文件将从服务器永久删除，且不可恢复。"
        confirmLabel="永久删除"
        loading={actionLoading === `delete-${pendingDelete?.id}`}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
