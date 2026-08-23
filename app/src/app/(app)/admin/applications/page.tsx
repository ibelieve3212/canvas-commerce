"use client";

import * as React from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ArrowUp, ArrowDown, Eye, EyeOff, RefreshCw } from "lucide-react";

interface AppItem {
  id: string;
  slug: string;
  name: string;
  isPublished: boolean;
  sortOrder: number;
  category: string;
}

export default function AdminAppsPage() {
  const showToast = useToast();
  const [apps, setApps] = React.useState<AppItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/applications");
    const json = await res.json();
    if (json.data) setApps(json.data);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, []);

  async function togglePublish(app: AppItem) {
    const res = await fetch("/api/admin/applications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ id: app.id, isPublished: !app.isPublished }]),
    });
    if (res.ok) {
      showToast("success", app.isPublished ? "已下架" : "已上架");
      void load();
    } else {
      showToast("error", "操作失败");
    }
  }

  async function move(app: AppItem, dir: -1 | 1) {
    const idx = apps.findIndex((a) => a.id === app.id);
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= apps.length) return;
    const updates = [
      { id: app.id, sortOrder: apps[targetIdx].sortOrder },
      { id: apps[targetIdx].id, sortOrder: app.sortOrder },
    ];
    const res = await fetch("/api/admin/applications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      void load();
    } else {
      showToast("error", "排序失败");
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">加载中…</p>;
  }

  return (
    <>
      <PageHeader title="应用管理" description="内置应用上架/下架与排序" />

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-1 size-4" /> 刷新
          </Button>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {apps.map((app, idx) => (
            <li key={app.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0"
                  onClick={() => move(app, -1)}
                  disabled={idx === 0}
                  aria-label="上移"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0"
                  onClick={() => move(app, 1)}
                  disabled={idx === apps.length - 1}
                  aria-label="下移"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--color-text)]">{app.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{app.slug} · {app.category}</p>
              </div>
              <Badge variant={app.isPublished ? "success" : "neutral"}>
                {app.isPublished ? "已上架" : "已下架"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => togglePublish(app)}
              >
                {app.isPublished ? (
                  <>
                    <EyeOff className="mr-1 size-4" /> 下架
                  </>
                ) : (
                  <>
                    <Eye className="mr-1 size-4" /> 上架
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
