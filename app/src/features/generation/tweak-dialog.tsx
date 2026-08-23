"use client";

import * as React from "react";
import { Loader2, X, Wand2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/**
 * 微调对话框（OPT-1）。
 * 用户输入微调描述 → POST /api/assets/[assetId]/tweak → 显示新结果。
 */
export function TweakDialog({
  assetId,
  assetUrl,
  onClose,
  onTweaked,
}: {
  assetId: string;
  assetUrl: string;
  onClose: () => void;
  onTweaked: () => void;
}) {
  const showToast = useToast();
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);

  async function handleSubmit() {
    if (!description.trim()) {
      showToast("error", "请输入微调描述");
      return;
    }
    setSubmitting(true);
    setResultUrl(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/tweak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "微调失败");
        return;
      }
      if (json.data?.imageUrl) {
        setResultUrl(json.data.imageUrl);
        onTweaked();
      }
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* 原图预览 */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">微调原图</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="grid size-6 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetUrl} alt="待微调图片" className="w-full" />
      </div>

      {/* 结果预览 */}
      {resultUrl && (
        <div>
          <span className="text-xs font-medium text-[var(--color-text-muted)]">微调结果</span>
          <div className="mt-1 overflow-hidden rounded-lg border border-[var(--color-border)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultUrl} alt="微调结果" className="w-full" />
          </div>
        </div>
      )}

      {/* 微调输入 */}
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
          微调描述
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例：把标题字号调大、移到左上角、改成红色"
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
          用自然语言描述微调需求，模型会基于原图调整。每次微调扣 1 次配额。
        </p>
      </div>

      <button
        type="button"
        disabled={submitting || !description.trim()}
        onClick={handleSubmit}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            微调中...
          </>
        ) : (
          <>
            <Wand2 className="size-4" />
            提交微调
          </>
        )}
      </button>
    </div>
  );
}
