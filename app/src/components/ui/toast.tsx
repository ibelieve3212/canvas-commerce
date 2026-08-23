"use client";

import * as React from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastType = "success" | "error" | "info";
interface ToastMsg { id: number; type: ToastType; text: string; }

const ToastCtx = React.createContext<{ show: (type: ToastType, text: string) => void } | null>(null);

export function useToast(): (type: ToastType, text: string) => void {
  const ctx = React.use(ToastCtx);
  return ctx?.show ?? (() => {});
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMsg[]>([]);
  const idRef = React.useRef(0);

  const show = React.useCallback((type: ToastType, text: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastCtx value={{ show }}>
      {children}
      <div className="fixed right-4 top-14 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-md",
              t.type === "success" && "border-[var(--color-success)] bg-[var(--color-surface)] text-[var(--color-text)]",
              t.type === "error" && "border-[var(--color-danger)] bg-[var(--color-surface)] text-[var(--color-text)]",
              t.type === "info" && "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]",
            )}
          >
            {t.type === "success" && <CheckCircle2 className="size-4 text-[var(--color-success)]" />}
            {t.type === "error" && <XCircle className="size-4 text-[var(--color-danger)]" />}
            {t.type === "info" && <Info className="size-4 text-[var(--color-text-muted)]" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx>
  );
}
