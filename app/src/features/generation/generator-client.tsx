"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { DynamicForm } from "@/features/generation/dynamic-form";
import { ResultPanel, type StubJob, type StubJobStatus, type StubTweakNode } from "@/features/generation/result-panel";
import { validateFormValues } from "@/contracts/generation";
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
  const [fromBatchId, setFromBatchId] = React.useState<string | null>(null);

  const [values, setValues] = React.useState<FormValues>(() => defaultValuesFor(app));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [jobs, setJobs] = React.useState<StubJob[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [firstErrorKey, setFirstErrorKey] = React.useState<string | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [requestedCount, setRequestedCount] = React.useState(() => computeOutputCount(app));
  const [restoring, setRestoring] = React.useState(false);
  const [restoreNotice, setRestoreNotice] = React.useState<string | null>(null);
  const succeededCount = jobs.filter((j) => j.status === "succeeded").length;

  // 从 URL 读取 fromBatch 参数
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const fb = params.get("fromBatch");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (fb) setFromBatchId(fb);
  }, []);

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
    </div>
  );
}
