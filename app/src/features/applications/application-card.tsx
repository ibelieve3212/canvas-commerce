"use client";

import Link from "next/link";
import { Heart, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/tooltip";
import type { Application } from "@/contracts/application";

export function ApplicationCard({
  app,
  isFavorite,
  onToggleFavorite,
}: {
  app: Application;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm transition-colors",
        "hover:border-[var(--color-accent)]/40",
      )}
    >
      <Link
        href={`/apps/${app.slug}`}
        className="flex flex-1 flex-col gap-2"
        aria-label={`进入 ${app.name}`}
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[var(--color-surface-subtle)] text-xl">
            {app.emojiIcon || "🧩"}
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <span className="text-[11px] text-[var(--color-text-muted)]">
              {app.kind === "DETAIL_PAGE" && "固定 6 张"}
              {app.kind === "MAIN_IMAGE" && "1/3/5 张"}
              {app.kind === "BUYER_SHOW" && "1/2/4 张"}
              {app.kind === "POSTER" && "1/2/4/6 张"}
              {app.kind === "CUSTOM" && "自定义"}
            </span>
          </div>
        </div>
        <h3 className="text-[15px] font-semibold text-[var(--color-text)]">
          {app.name}
        </h3>
        <p className="line-clamp-1 text-xs text-[var(--color-text-muted)]">
          {app.tagline}
        </p>
        <div className="mt-auto flex flex-wrap gap-1 pt-2">
          {app.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-[var(--color-surface-subtle)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(app.id);
        }}
        aria-label={isFavorite ? "取消收藏" : "收藏"}
        aria-pressed={isFavorite}
        className={cn(
          "absolute right-2 bottom-2 grid size-8 place-items-center rounded-lg transition-colors",
          isFavorite
            ? "text-[var(--color-accent)]"
            : "text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] hover:opacity-100",
        )}
      >
        {isFavorite ? (
          <Star className="size-4 fill-current" />
        ) : (
          <Heart className="size-4" />
        )}
      </button>
    </div>
  );
}

export function EmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] py-16 text-center">
      <Tooltip content="无匹配应用">
        <span className="grid size-12 place-items-center rounded-full bg-[var(--color-surface)] text-[var(--color-text-muted)]">
          <Heart className="size-5" />
        </span>
      </Tooltip>
      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
        没有匹配的应用
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 text-sm font-medium text-[var(--color-accent)] hover:underline"
      >
        清除筛选
      </button>
    </div>
  );
}
