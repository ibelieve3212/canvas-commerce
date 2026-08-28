"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { DynamicForm } from "@/features/generation/dynamic-form";
import { ResultPanel, type StubJob, type StubJobStatus, type StubTweakNode } from "@/features/generation/result-panel";
import { useFormDraft } from "@/features/generation/use-form-draft";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { validateFormValues, classifyCopySource } from "@/contracts/generation";
import { cn } from "@/lib/cn";
import { Loader2 } from "lucide-react";
import type { Application } from "@/contracts/application";
import type { FormValues } from "@/contracts/generation";

function defaultValuesFor(app: Application): FormValues {
  const v: FormValues = {};
  for (const f of app.formSchema) {
    switch (f.type) {
      case "text":
      case "textarea":
      case "select":
      case "radio":
        v[f.key] = f.defaultValue ?? "";
        break;
      case "multiselect":
        v[f.key] = f.defaultValues ?? [];
        break;
      case "checkbox":
        v[f.key] = f.defaultValue ?? false;
        break;
      case "slider":
        v[f.key] = f.defaultValue;
        break;
      case "image":
        v[f.key] = [];
        break;
    }
  }
  return v;
}

function computeOutputCount(app: Application): number {
  if (app.outputConfig?.mode === "fixed") return app.outputConfig.count;
  const opts = app.outputConfig?.options ?? [1];
  return opts[0];
}

interface TweakAsset {
  id: string;
  objectKey: string;
  thumbnailKey: string | null;
  childAssets: TweakAsset[];
}

interface ApiJob {
  id: string;
  outputIndex: number;
  outputRole: string;
  status: StubJobStatus;
  asset: { id: string; objectKey: string; thumbnailKey?: string | null; childAssets?: TweakAsset[] } | null;
  errorCode: string | null;
  errorMessage: string | null;
}

interface ApiBatch {
  id: string;
  status: string;
  aspectRatio: string;
  requestedCount: number;
  succeededCount: number;
  failedCount: number;
  jobs: ApiJob[];
}

function mapTweakAssets(assets: TweakAsset[]): StubTweakNode[] {
  return assets.map((a) => ({
    assetId: a.id,
    imageUrl: `/api/storage/${encodeURIComponent(a.objectKey)}`,
    thumbnailUrl: a.thumbnailKey
      ? `/api/storage/${encodeURIComponent(a.thumbnailKey)}`
      : undefined,
    children: mapTweakAssets(a.childAssets ?? []),
  }));
}

function mapApiJobsToStubJobs(batch: ApiBatch, app: Application): StubJob[] {
  return batch.jobs.map((job) => {
    const role = app.outputRoles.find((r) => r.outputIndex === job.outputIndex);
    return {
      id: job.id,
      outputIndex: job.outputIndex,
      outputRole: job.outputRole,
      title: role?.title ?? `${app.name} ${job.outputIndex}`,
      description: role?.description,
      status: job.status,
      imageUrl: job.asset ? `/api/storage/${encodeURIComponent(job.asset.objectKey)}` : undefined,
      assetId: job.asset?.id,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      tweaks: job.asset?.childAssets ? mapTweakAssets(job.asset.childAssets) : [],
    };
  });
}

export function GeneratorClient({ app }: { app: Application }) {
  // 用 useSearchParams 而不是挂载时读 window.location：从任务中心点"恢复配置"
  // 是客户端路由跳转，组件可能先渲染、URL 后更新。用 useState 初始化器读的话
  // 那一刻 ?fromBatch= 还不在 URL 里，会误判成"不是批次恢复"，
  // 于是草稿抢先把批次参数覆盖掉（实测：显示的是草稿内容而非批次内容）。
  const searchParams = useSearchParams();
  const fromBatchId = searchParams.get("fromBatch");

  const defaults = React.useMemo(() => defaultValuesFor(app), [app]);
  const [values, setValues] = React.useState<FormValues>(defaults);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [jobs, setJobs] = React.useState<StubJob[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [firstErrorKey, setFirstErrorKey] = React.useState<string | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [requestedCount, setRequestedCount] = React.useState(() => computeOutputCount(app));
  const [restoring, setRestoring] = React.useState(false);
  const [restoreNotice, setRestoreNotice] = React.useState<string | null>(null);
  const [confirmingNoCopy, setConfirmingNoCopy] = React.useState(false);
  const succeededCount = jobs.filter((j) => j.status === "succeeded").length;

  // 该应用的模板是否真的会用到文案指令。买家秀没有 {{copy_directive}}，
  // 它的输出与文案字段无关，不该为它弹这个确认。
  const usesCopyDirective = app.promptTemplate.includes("{{copy_directive}}");
  const needsCopyConfirm =
    usesCopyDirective && classifyCopySource(values) === "none";

  // 提示里点名该应用实际有的那个卖点字段：详情页/海报叫「商品卖点」，
  // 主图叫「商品信息」。说错字段名用户会去找一个不存在的输入框。
  const copyFieldLabel = React.useMemo(() => {
    const labelOf = (key: string) =>
      app.formSchema.find((f) => f.key === key)?.label ?? null;
    return labelOf("selling_points") ?? labelOf("info");
  }, [app.formSchema]);

  // 未提交的填写内容存本地。从历史批次恢复时不参与，避免两者打架。
  const draft = useFormDraft(app.id, values, requestedCount, defaults, !fromBatchId);

  // 从 URL 读取 fromBatch 参数（已在 useState 初始化时同步读取）

  // 恢复本地草稿：用户填了一半跑去别的页面（如聊天页复制卖点），回来还在。
  // 从历史批次恢复时跳过——那条路径有自己的参数来源，两者会互相覆盖。
  const draftAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (draftAppliedRef.current) return;
    if (!draft.restored || fromBatchId) return;
    draftAppliedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues(draft.restored.values);
    if (draft.restored.requestedCount) setRequestedCount(draft.restored.requestedCount);
    const at = new Date(draft.restored.savedAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    setRestoreNotice(`已恢复 ${at} 未提交的填写内容`);
  }, [draft.restored, fromBatchId]);

  // 从历史批次恢复参数
  React.useEffect(() => {
    if (!fromBatchId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestoring(true);
    fetch(`/api/batches/${fromBatchId}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (cancelled || !json?.data) { setRestoring(false); return; }
        const snapshot = JSON.parse(json.data.inputSnapshotJson) as {
          formValues: Record<string, unknown>;
          referenceImages?: { uploadId: string; role: string }[];
          requestedCount: number;
          aspectRatio: string;
        };
        // 恢复表单值
        const restored = { ...defaultValuesFor(app) };
        for (const f of app.formSchema) {
          if (snapshot.formValues[f.key] !== undefined) {
            restored[f.key] = snapshot.formValues[f.key];
          }
        }
        if (!cancelled) {
          setValues(restored);
          if (snapshot.requestedCount) setRequestedCount(snapshot.requestedCount);
          setBatchId(fromBatchId);
          setRestoreNotice(`已从 ${new Date(json.data.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 的生成恢复参数，可微调后重新生成`);
          setRestoring(false);
        }
      })
      .catch(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [fromBatchId, app]);

  const onChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // 轮询
  React.useEffect(() => {
    if (!batchId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/batches/${batchId}`);
        if (!res.ok) return;
        const json = await res.json();
        const batch: ApiBatch = json.data;
        if (cancelled) return;

        setJobs(mapApiJobsToStubJobs(batch, app));

        // 判断是否结束
        const terminal = batch.jobs.every(
          (j) => j.status === "succeeded" || j.status === "failed" || j.status === "canceled",
        );
        if (terminal) {
          setSubmitting(false);
          return;
        }
        // 继续轮询
        setTimeout(() => void poll(), 1500);
      } catch {
        if (!cancelled) {
          setTimeout(() => void poll(), 3000);
        }
      }
    }

    void poll();
    return () => { cancelled = true; };
  }, [batchId, app]);

  const handleSubmit = async () => {
    const result = validateFormValues(app.formSchema, values);
    if (!result.ok) {
      setErrors(result.errors);
      const firstKey = app.formSchema.find((f) => result.errors[f.key])?.key ?? null;
      setFirstErrorKey(firstKey);
      if (firstKey) {
        const el = document.getElementById(firstKey) as HTMLElement | null;
        el?.focus();
      }
      return;
    }

    // 文案三个来源全空时，prompt 里会写死"不要在图上写任何文字"，
    // 出的是纯无字图。这是设计如此，但没提示的话像是生成不完整，
    // 用户会以为失败了又重跑一遍。只在模板真的吃 copy_directive 时才问——
    // 买家秀没有这个占位符，对它来说填不填文案都不影响输出。
    if (needsCopyConfirm) {
      setConfirmingNoCopy(true);
      return;
    }

    await doSubmit();
  };

  const doSubmit = async () => {
    setConfirmingNoCopy(false);
    setErrors({});
    setFirstErrorKey(null);
    setSubmitError(null);
    setSubmitting(true);
    setJobs([]);

    try {
      const idempotencyKey = `${app.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // 从 formValues 中的 image 字段收集 referenceImages
      const referenceImages: { uploadId: string; role: "product" | "style" | "person" | "brand" }[] = [];
      for (const f of app.formSchema) {
        if (f.type === "image") {
          const val = values[f.key];
          if (Array.isArray(val)) {
            for (const item of val as Array<Record<string, string>>) {
              if (item.uploadId) {
                referenceImages.push({
                  uploadId: item.uploadId,
                  role: (f.roles?.[0] ?? "product") as "product" | "style" | "person" | "brand",
                });
              }
            }
          }
        }
      }

      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: app.id,
          formValues: values,
          referenceImages,
          aspectRatio: app.defaultAspectRatio,
          requestedCount,
          idempotencyKey,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error?.message || "提交失败");
        setSubmitting(false);
        return;
      }
      setBatchId(json.data.batchId);
      // 提交成功，这份草稿已经用掉了
      draft.clear();
      setRestoreNotice(null);
    } catch {
      setSubmitError("网络错误，请重试");
      setSubmitting(false);
    }
  };

  const handleRetry = async (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "running", errorCode: null, errorMessage: null } : j)),
    );
    try {
      const res = await fetch(`/api/batches/${batchId}/jobs/${jobId}/retry`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        setSubmitError(json.error?.message || "重试失败");
        // 恢复状态
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: "failed" } : j)),
        );
      }
      // 轮询 effect 会自动更新
    } catch {
      setSubmitError("网络错误");
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: "failed" } : j)),
      );
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]">
      {/* 参数面板 */}
      <div className="lg:sticky lg:top-[72px] lg:self-start">
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          {restoreNotice && (
            <div className="mb-3 rounded-lg border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5 px-3 py-2 text-xs text-[var(--color-accent)]">
              {restoreNotice}
            </div>
          )}
          {restoring ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-[var(--color-text-muted)]" />
            </div>
          ) : (
            <>
          <DynamicForm
            schema={app.formSchema}
            values={values}
            errors={errors}
            onChange={onChange}
          />
          {app.outputConfig?.mode === "selectable" && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <Label>生成数量</Label>
              <div className="mt-2 flex gap-2">
                {app.outputConfig.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setRequestedCount(opt)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      requestedCount === opt
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
                    )}
                  >
                    {opt} 张
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <Button
              onClick={handleSubmit}
              loading={submitting}
              className="w-full"
              size="lg"
            >
              生成 {requestedCount} 张{app.name}
            </Button>
            {firstErrorKey && errors[firstErrorKey] && (
              <p className="mt-2 text-xs text-[var(--color-danger)]" role="alert">
                请修正标红字段后再提交
              </p>
            )}
            {submitError && (
              <p className="mt-2 text-xs text-[var(--color-danger)]" role="alert">
                {submitError}
              </p>
            )}
          </div>
            </>
          )}
        </div>
      </div>

      {/* 结果面板 */}
      <div className="min-w-0">
        <ResultPanel
          app={app}
          jobs={jobs}
          requestedCount={requestedCount}
          succeededCount={succeededCount}
          submitting={submitting}
          onSubmit={handleSubmit}
          onRetry={handleRetry}
          onTweaked={() => {
            if (!batchId) return;
            fetch(`/api/batches/${batchId}`)
              .then(r => r.ok ? r.json() : null)
              .then(json => {
                if (json?.data) {
                  setJobs(mapApiJobsToStubJobs(json.data, app));
                }
              })
              .catch(() => {});
          }}
          batchId={batchId}
          applicationId={app.id}
        />
      </div>

      <ConfirmDialog
        open={confirmingNoCopy}
        tone="info"
        title="这批图不会带任何文案"
        description={
          <>
            <p>
              「图片文案」
              {copyFieldLabel ? `和「${copyFieldLabel}」` : ""}
              都留空了，生成的会是纯画面、不带一个字的图。
            </p>
            <p className="mt-2">
              想让图上出现文字：自己写「图片文案」会照原样印上去
              {copyFieldLabel ? `，或填「${copyFieldLabel}」让 AI 自动提炼` : ""}。
            </p>
          </>
        }
        confirmLabel="就要无文案的图"
        cancelLabel="返回填写"
        onConfirm={() => void doSubmit()}
        onCancel={() => setConfirmingNoCopy(false)}
      />
    </div>
  );
}
