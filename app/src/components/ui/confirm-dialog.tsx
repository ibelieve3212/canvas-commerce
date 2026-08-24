"use client";

/**
 * 危险操作二次确认对话框。
 *
 * 项目里所有删除确认统一走这里——原先四个入口各用原生 `confirm()`，
 * 只有管理员存储页是自定义弹窗，交互与措辞都不一致。
 * 详见 `docs/v2/12-DELETION-REFACTOR.md` 第 4 步。
 *
 * 原生 confirm 还有两个实际问题：样式不受控（与设计系统脱节），
 * 且会阻塞事件循环——Playwright 默认自动 dismiss，导致删除用例静默空跑。
 */
import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 正文。用 ReactNode 以便调用方强调关键数字（如"将删除 N 张"）。 */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  /**
   * 要求用户逐字输入此文本才能确认。用于影响面大的操作（如管理员批量删除）。
   * 留空则只需点确认。
   */
  requireTypedText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  // 关闭时整体卸载，下次打开是全新实例——输入框状态自然清空，
  // 不需要在 effect 里 setState（那会触发级联渲染）。
  if (!props.open) return null;
  return <ConfirmDialogInner {...props} />;
}

function ConfirmDialogInner({
  title,
  description,
  confirmLabel = "删除",
  cancelLabel = "取消",
  loading = false,
  requireTypedText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // 打开时把焦点移进对话框：键盘用户否则要从页首 Tab 过来
  React.useEffect(() => {
    if (requireTypedText) inputRef.current?.focus();
    else confirmRef.current?.focus();
  }, [requireTypedText]);

  // Esc 关闭。危险操作要让用户随时能全身而退。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, onCancel]);

  const canConfirm = !loading && (!requireTypedText || typed === requireTypedText);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={() => !loading && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          {/* 图标只作视觉强化，危险语义同时由标题文字和按钮文案承载（不靠颜色传达状态） */}
          <AlertTriangle aria-hidden className="size-5 text-[var(--color-danger)]" />
          <h3 id="confirm-dialog-title" className="text-sm font-semibold text-[var(--color-text)]">
            {title}
          </h3>
        </div>

        <div id="confirm-dialog-desc" className="mb-4 text-sm text-[var(--color-text-muted)]">
          {description}
        </div>

        {requireTypedText && (
          <>
            <label
              htmlFor="confirm-dialog-input"
              className="mb-2 block text-xs text-[var(--color-text-muted)]"
            >
              请输入“{requireTypedText}”以确认：
            </label>
            <input
              id="confirm-dialog-input"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTypedText}
              className="mb-4 h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
            />
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={loading} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant="danger"
            size="sm"
            loading={loading}
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
