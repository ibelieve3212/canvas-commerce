"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { RefreshCw, Download, Clock, Loader2, CheckCircle2, XCircle, Ban, FolderArchive, Image as ImageIcon, History, ChevronDown, ChevronUp, Wand2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Application } from "@/contracts/application";
import { useToast } from "@/components/ui/toast";
import { TweakDialog } from "./tweak-dialog";
import { HoverPreview } from "./hover-preview";

// ---- 会话历史类型 ----

interface SessionJob {
  id: string;
  outputIndex: number;
  outputRole: string;
  status: string;
  asset: { id: string; objectKey: string; thumbnailKey?: string | null } | null;
}

interface SessionBatch {
  id: string;
  createdAt: string;
  status: string;
  requestedCount: number;
  succeededCount: number;
  aspectRatio: string;
  application: { slug: string; name: string; emojiIcon: string | null };
  jobs: SessionJob[];
}

export type StubJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface StubTweakNode {
  assetId: string;
  imageUrl: string;
  thumbnailUrl?: string;
  children: StubTweakNode[];
}

export interface StubJob {
  id: string;
  outputIndex: number;
  outputRole?: string;
  title: string;
  description?: string;
  status: StubJobStatus;
  imageUrl?: string;
  assetId?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  tweaks?: StubTweakNode[];
}

export function ResultPanel({
  app,
  jobs,
  requestedCount,
  succeededCount,
  submitting,
  onSubmit,
  onRetry,
  onTweaked,
  batchId,
  applicationId,
}: {
  app: Application;
  jobs: StubJob[];
  requestedCount: number;
  succeededCount: number;
  submitting: boolean;
  onSubmit: () => void;
  onRetry: (jobId: string) => void;
  onTweaked?: () => void;
  batchId?: string | null;
  applicationId: string;
}) {
  const hasJobs = jobs.length > 0;
  const finished =
    jobs.length > 0 &&
    jobs.every((j) => j.status === "succeeded" || j.status === "failed" || j.status === "canceled");

  return (
    <div className="flex h-full flex-col">
      {/* 应用头部 */}
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-[var(--color-surface-subtle)] text-xl">
          {app.emojiIcon || "🧩"}
        </span>
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{app.name}</h2>
          <p className="line-clamp-1 text-xs text-[var(--color-text-muted)]">{app.tagline}</p>
        </div>
      </div>

      {/* 出图历史 / 版本对比 */}
      <SessionHistory applicationId={applicationId} currentBatchId={batchId} />

      {/* 进度与操作 */}
      {hasJobs && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--color-text-muted)]">完成进度</span>
            <Badge variant={succeededCount === requestedCount ? "success" : "warning"}>
              完成 {succeededCount}/{requestedCount}
            </Badge>
            {finished && (
              <span className="ml-1 text-xs text-[var(--color-text-muted)]">
                {succeededCount === requestedCount ? "全部完成" : "已结束"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {succeededCount > 0 && (
              <ExportButtons batchId={batchId} succeededCount={succeededCount} />
            )}
            <button
              type="button"
              onClick={onSubmit}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
            >
              重新生成
            </button>
          </div>
        </div>
      )}

      {/* 结果网格 / 空态 */}
      {!hasJobs ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] py-16 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-muted)]">
            <CheckCircle2 className="size-5" />
          </span>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            填写左侧参数后点击生成
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {submitting ? "提交中…" : "结果将在这里逐张展示"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {jobs.map((job) => (
            <ResultCard key={job.id} job={job} onRetry={onRetry} onTweaked={onTweaked} />
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ job, onRetry, onTweaked }: { job: StubJob; onRetry: (id: string) => void; onTweaked?: () => void }) {
  const [showTweak, setShowTweak] = React.useState(false);
  const currentUrl = job.imageUrl;

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      {showTweak && job.assetId && currentUrl ? (
        <TweakDialog
          assetId={job.assetId}
          assetUrl={currentUrl}
          onClose={() => setShowTweak(false)}
          onTweaked={() => {
            setShowTweak(false);
            onTweaked?.();
          }}
        />
      ) : (
        <>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-text)]">{job.title}</p>
          {job.description && (
            <p className="truncate text-[11px] text-[var(--color-text-muted)]">{job.description}</p>
          )}
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div
        className={cn(
          "relative aspect-[4/3] bg-[var(--color-surface-subtle)]",
          job.status === "succeeded" ? "" : "grid place-items-center",
        )}
      >
        {job.status === "succeeded" && currentUrl ? (
          <HoverPreview
            src={currentUrl}
            alt={job.title}
            className="size-full"
            imgClassName="size-full object-contain"
          />
        ) : job.status === "succeeded" ? (
          <div className="size-full bg-gradient-to-br from-[var(--color-accent)]/10 to-[var(--color-info)]/10" />
        ) : (
          <StatusIcon status={job.status} />
        )}
        {showTweak && (
          <div className="absolute left-1 top-1 rounded bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-medium text-white">
            微调中
          </div>
        )}
        {job.status === "failed" && job.errorMessage && (
          <div className="absolute inset-x-0 bottom-0 bg-[var(--color-danger)]/90 px-3 py-1.5 text-[11px] text-white">
            {job.errorMessage}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
          {job.id.slice(0, 8)}
        </span>
        <div className="flex items-center gap-1">
          {job.status === "succeeded" && job.assetId && (
            <Tooltip content="微调">
              <button
                type="button"
                aria-label="微调"
                onClick={() => setShowTweak(true)}
                className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <Wand2 className="size-4" />
              </button>
            </Tooltip>
          )}
          {job.status === "failed" && (
            <Tooltip content="重试">
              <button
                type="button"
                aria-label="重试"
                onClick={() => onRetry(job.id)}
                className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              >
                <RefreshCw className="size-4" />
              </button>
            </Tooltip>
          )}
          {job.status === "succeeded" && currentUrl && (
            <a
              href={currentUrl}
              download
              aria-label="下载"
              className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            >
              <Download className="size-4" />
            </a>
          )}
        </div>
          </div>
        </>
      )}

      {/* 微调子节点分支 */}
      {job.tweaks && job.tweaks.length > 0 && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2">
          <p className="mb-1.5 text-[11px] font-medium text-[var(--color-text-muted)]">微调版本</p>
          <div className="flex flex-wrap gap-3">
            {job.tweaks.map((tweak, i) => (
              <TweakBranch key={tweak.assetId} node={tweak} depth={i + 1} onTweaked={onTweaked} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 微调弹窗渲染 props（ResultCard 和 TweakBranch 共用） */
interface TweakDialogState {
  assetId: string;
  imageUrl: string;
}

/**
 * 渲染微调分支（缩略图 + 深度标识）。支持对微调结果继续微调。
 */
function TweakBranch({ node, depth, onTweaked }: { node: StubTweakNode; depth: number; onTweaked?: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [showTweak, setShowTweak] = React.useState<TweakDialogState | null>(null);
  const hasChildren = node.children && node.children.length > 0;
  const url = node.thumbnailUrl ?? node.imageUrl;
  // 轮次递减尺寸：L1=128px, L2=88px, L3=56px
  const sizeClass = depth === 1 ? "size-32" : depth === 2 ? "size-[88px]" : "size-14";

  return (
    <div className="space-y-1">
      {showTweak && (
        <TweakDialog
          assetId={showTweak.assetId}
          assetUrl={showTweak.imageUrl}
          onClose={() => setShowTweak(null)}
          onTweaked={() => {
            setShowTweak(null);
            onTweaked?.();
          }}
        />
      )}
      <div
        className={cn("group relative overflow-hidden rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)]", sizeClass)}
        onClick={() => setExpanded(v => !v)}
        style={{ cursor: "pointer" }}
      >
        <HoverPreview
          src={url}
          fullSrc={node.imageUrl}
          alt={`微调第${depth}轮`}
          className="size-full"
          imgClassName="size-full object-cover"
        />
        <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 text-[9px] text-white">
          L{depth}
        </span>
        {hasChildren && (
          <span className="absolute left-0 top-0 size-2 rounded-full bg-[var(--color-accent)]" />
        )}
      </div>
      {expanded && (
        <div className="flex items-center gap-2 text-[10px]">
          <a
            href={node.imageUrl}
            download
            className="text-[var(--color-accent)] hover:underline"
          >
            下载
          </a>
          {depth < 3 && (
            <button
              type="button"
              onClick={() => setShowTweak({ assetId: node.assetId, imageUrl: node.imageUrl })}
              className="inline-flex items-center gap-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
            >
              <Wand2 className="size-3" />
              微调
            </button>
          )}
        </div>
      )}
      {/* 递归子节点 */}
      {hasChildren && expanded && (
        <div className="ml-3 border-l border-[var(--color-border)] pl-2">
          {node.children.map((child) => (
            <TweakBranch key={child.assetId} node={child} depth={depth + 1} onTweaked={onTweaked} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StubJobStatus }) {
  switch (status) {
    case "queued":
      return <Badge variant="neutral">排队中</Badge>;
    case "running":
      return <Badge variant="warning">生成中</Badge>;
    case "succeeded":
      return <Badge variant="success">完成</Badge>;
    case "failed":
      return <Badge variant="danger">失败</Badge>;
    case "canceled":
      return <Badge variant="neutral">已取消</Badge>;
  }
}

function StatusIcon({ status }: { status: StubJobStatus }) {
  const cls = "size-6";
  switch (status) {
    case "queued":
      return <Clock className={cn(cls, "text-[var(--color-text-muted)]")} />;
    case "running":
      return <Loader2 className={cn(cls, "animate-spin text-[var(--color-warning)]")} />;
    case "failed":
      return <XCircle className={cn(cls, "text-[var(--color-danger)]")} />;
    case "canceled":
      return <Ban className={cn(cls, "text-[var(--color-text-muted)]")} />;
    default:
      return null;
  }
}

function ExportButtons({ batchId, succeededCount }: { batchId?: string | null; succeededCount: number }) {
  const showToast = useToast();
  const [exporting, setExporting] = React.useState<"zip" | "long" | null>(null);

  async function handleExport(type: "ZIP" | "LONG_IMAGE") {
    if (!batchId) return;
    setExporting(type === "ZIP" ? "zip" : "long");
    try {
      const res = await fetch(`/api/exports/${batchId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "导出失败");
        return;
      }
      showToast("success", type === "ZIP" ? `ZIP 打包成功（${succeededCount} 张）` : "长图拼接成功");
      // 自动触发下载
      if (json.data?.downloadUrl) {
        window.open(json.data.downloadUrl, "_blank");
      }
    } catch {
      showToast("error", "网络错误");
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={exporting !== null}
        onClick={() => handleExport("ZIP")}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-50"
      >
        {exporting === "zip" ? <Loader2 className="size-3 animate-spin" /> : <FolderArchive className="size-3" />}
        ZIP
      </button>
      <button
        type="button"
        disabled={exporting !== null}
        onClick={() => handleExport("LONG_IMAGE")}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-50"
      >
        {exporting === "long" ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
        长图
      </button>
    </>
  );
}

// ---- 出图历史 / 版本对比 ----

function formatTime(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 会话级出图历史：按 applicationId 拉取该应用下最近批次，可横向对比缩略图 */
function SessionHistory({ applicationId, currentBatchId }: {
  applicationId: string;
  currentBatchId?: string | null;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [batches, setBatches] = React.useState<SessionBatch[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [previewBatch, setPreviewBatch] = React.useState<SessionBatch | null>(null);
  const router = useRouter();

  // 拉取该应用下最近 10 个批次
  React.useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/batches?applicationId=${encodeURIComponent(applicationId)}&pageSize=10`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.data?.items) {
          setLoading(false);
          return;
        }
        setBatches(json.data.items as SessionBatch[]);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [expanded, applicationId]);

  // 自动选中当前批次
  React.useEffect(() => {
    if (batches.length === 0 || !currentBatchId) return;
    const found = batches.find(b => b.id === currentBatchId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found) setPreviewBatch(found);
  }, [batches, currentBatchId]);

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--color-surface-subtle)]"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)]">
          <History className="size-3.5 text-[var(--color-text-muted)]" />
          出图历史
          {batches.length > 0 && (
            <span className="ml-1 rounded-full bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
              {batches.length} 次生成
            </span>
          )}
        </span>
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-[var(--color-text-muted)]" />
        ) : expanded ? (
          <ChevronUp className="size-3.5 text-[var(--color-text-muted)]" />
        ) : (
          <ChevronDown className="size-3.5 text-[var(--color-text-muted)]" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border)] p-3">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : batches.length === 0 ? (
            <p className="py-2 text-center text-xs text-[var(--color-text-muted)]">
              暂无历史。在该页面生成图片后，这里可以横向对比不同参数下的结果。
            </p>
          ) : (
            <>
              {/* 批次缩略图列表 */}
              <div className="flex gap-2 overflow-x-auto pb-2">
                {batches.map((batch) => {
                  const firstOk = batch.jobs.find(j => j.status === "succeeded" && j.asset);
                  const thumb = firstOk?.asset?.thumbnailKey
                    ? `/api/storage/${encodeURIComponent(firstOk.asset.thumbnailKey)}`
                    : firstOk?.asset
                      ? `/api/storage/${encodeURIComponent(firstOk.asset.objectKey)}`
                      : null;
                  const isActive = previewBatch?.id === batch.id;
                  const isCurrent = batch.id === currentBatchId;
                  return (
                    <button
                      key={batch.id}
                      type="button"
                      onClick={() => setPreviewBatch(batch)}
                      aria-label={`批次 ${formatTime(batch.createdAt)}`}
                      className={cn(
                        "relative flex-shrink-0 overflow-hidden rounded border-2 bg-[var(--color-surface-subtle)] transition-colors",
                        isActive
                          ? "border-[var(--color-accent)]"
                          : "border-transparent hover:border-[var(--color-border)]",
                      )}
                      style={{ width: 72, height: 54 }}
                    >
                      {thumb ? (
                        <HoverPreview src={thumb} fullSrc={firstOk?.asset ? `/api/storage/${encodeURIComponent(firstOk.asset.objectKey)}` : undefined} alt="" className="size-full" imgClassName="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center">
                          <ImageIcon className="size-4 text-[var(--color-text-muted)]" />
                        </span>
                      )}
                      {isCurrent && (
                        <span className="absolute left-0 top-0 rounded-br bg-[var(--color-accent)] px-1 py-0.5 text-[9px] font-medium text-white">
                          当前
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 选中版本的详细信息和图片网格 */}
              <div className="mt-3">
                {(() => {
                  const target = previewBatch ?? batches.find(b => b.id === currentBatchId) ?? batches[0] ?? null;
                  if (!target) return null;
                  const okJobs = target.jobs.filter(j => j.status === "succeeded" && j.asset);
                  const isCurrent = target.id === currentBatchId;
                  return (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                          {formatTime(target.createdAt)} · {target.succeededCount}/{target.requestedCount} 张成功
                          {isCurrent && <span className="ml-1 rounded bg-[var(--color-accent)]/10 px-1 py-0.5 text-[var(--color-accent)]">当前批次</span>}
                        </p>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => router.push(`/apps/${target.application.slug}?fromBatch=${target.id}`)}
                            className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)]"
                          >
                            <History className="size-3" />
                            恢复配置
                          </button>
                        )}
                      </div>
                      {okJobs.length === 0 ? (
                        <p className="py-2 text-center text-xs text-[var(--color-text-muted)]">该批次无成功图</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {okJobs.map(j => {
                            const url = j.asset!.thumbnailKey
                              ? `/api/storage/${encodeURIComponent(j.asset!.thumbnailKey)}`
                              : `/api/storage/${encodeURIComponent(j.asset!.objectKey)}`;
                            return (
                              <div
                                key={j.id}
                                className="block aspect-[4/3] overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-surface-subtle)]"
                              >
                                <HoverPreview src={url} fullSrc={`/api/storage/${encodeURIComponent(j.asset!.objectKey)}`} alt={j.outputRole} className="block size-full" imgClassName="size-full object-cover hover:opacity-80" />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
