"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Application, ApplicationCategory } from "@/contracts/application";
import { categoryLabels } from "@/server/applications/categories";
import { ApplicationCard, EmptyState } from "./application-card";
import { useFavorites } from "./use-favorites";

const categories: ApplicationCategory[] = [
  "ALL",
  "DETAIL_POSTER",
  "SCENE_MODEL",
  "BATCH",
  "IMAGE",
  "MINE",
];

export function ApplicationsBrowser({
  apps,
}: {
  apps: Application[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const { favorites, toggle, hydrated } = useFavorites();

  const q = searchParams.get("q") ?? "";
  const category = (searchParams.get("category") as ApplicationCategory) ?? "ALL";
  const onlyFavorites = searchParams.get("favorites") === "1";

  // 本地输入态，避免每次按键触发路由
  const [input, setInput] = useState(q);

  const updateUrl = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return apps.filter((app) => {
      if (category !== "ALL") {
        if (category === "MINE") return false;
        if (app.category !== category) return false;
      }
      if (onlyFavorites && !favorites.has(app.id)) return false;
      if (query) {
        const haystack = [app.name, app.description, app.tagline, app.tags.join(" ")]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [apps, q, category, onlyFavorites, favorites]);

  const hasFilter = q !== "" || category !== "ALL" || onlyFavorites;

  return (
    <div>
      {/* 搜索框 */}
      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="search"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            updateUrl({ q: e.target.value });
          }}
          placeholder="搜索应用名称、标签或描述"
          aria-label="搜索应用"
          className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-9 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
        />
        {input && (
          <button
            type="button"
            aria-label="清除搜索"
            onClick={() => {
              setInput("");
              updateUrl({ q: undefined });
            }}
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* 工作流步骤（静态提示） */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 text-[11px] text-[var(--color-text-muted)]">
        {["选择应用", "上传素材", "配置参数", "异步生成", "查看/比较/下载"].map((step, i) => (
          <span key={step} className="flex shrink-0 items-center gap-1.5">
            <span className="grid size-4 place-items-center rounded-full bg-[var(--color-surface-subtle)] text-[10px]">
              {i + 1}
            </span>
            {step}
            {i < 4 && <span className="text-[var(--color-border)]">→</span>}
          </span>
        ))}
      </div>

      {/* 分类 Tabs + 收藏过滤 */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => updateUrl({ category: cat === "ALL" ? undefined : cat })}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              category === cat
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]",
            )}
          >
            {categoryLabels[cat]}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
        <button
          type="button"
          onClick={() => updateUrl({ favorites: onlyFavorites ? undefined : "1" })}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition-colors",
            onlyFavorites
              ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
          )}
        >
          仅看收藏
        </button>
      </div>

      {/* 应用网格 */}
      {filtered.length === 0 ? (
        <EmptyState
          onClear={() => {
            setInput("");
            updateUrl({ q: undefined, category: undefined, favorites: undefined });
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              isFavorite={hydrated && favorites.has(app.id)}
              onToggleFavorite={toggle}
            />
          ))}
        </div>
      )}

      {hasFilter && filtered.length > 0 && (
        <div className="mt-4 text-xs text-[var(--color-text-muted)]">
          共 {filtered.length} 个应用 ·
          <button
            type="button"
            onClick={() => {
              setInput("");
              updateUrl({ q: undefined, category: undefined, favorites: undefined });
            }}
            className="ml-1 text-[var(--color-accent)] hover:underline"
          >
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
