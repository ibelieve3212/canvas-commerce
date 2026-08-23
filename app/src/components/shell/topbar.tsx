"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { NamedIcon } from "@/components/ui/icon";
import { X, Menu, LogOut } from "lucide-react";
import { desktopNav, adminNav } from "@/lib/site";
import { useCurrentUser } from "@/app/(app)/user-context";

export function Topbar() {
  const pathname = usePathname();
  const [mobileMenu, setMobileMenu] = useState(false);

  const breadcrumb = pathnameToBreadcrumb(pathname);

  const allNav = [...desktopNav, ...adminNav];

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 backdrop-blur lg:px-6">
      <button
        type="button"
        className="grid size-9 place-items-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] lg:hidden"
        aria-label={mobileMenu ? "关闭菜单" : "打开菜单"}
        aria-expanded={mobileMenu}
        onClick={() => setMobileMenu((v) => !v)}
      >
        {mobileMenu ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      <nav aria-label="面包屑" className="flex items-center gap-1.5 text-sm">
        {breadcrumb.map((seg, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[var(--color-text-muted)]">/</span>}
            {seg.href ? (
              <Link
                href={seg.href}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                {seg.label}
              </Link>
            ) : (
              <span className="font-medium text-[var(--color-text)]">
                {seg.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <UserMenu />
      </div>

      {mobileMenu && (
        <div className="absolute left-0 top-full w-full border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2 lg:hidden">
          {allNav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenu(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm",
                  active
                    ? "bg-[var(--color-accent)]/8 font-medium text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
                )}
              >
                <NamedIcon name={item.icon} className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}

function pathnameToBreadcrumb(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "首页" }];

  const labelMap: Record<string, string> = {
    apps: "应用中心",
    "main-image": "商品主图",
    "detail-page": "AI 详情页",
    "buyer-show": "买家秀",
    poster: "营销海报",
    custom: "自定义应用",
    "app-builder": "创建应用",
    tasks: "任务中心",
    assets: "资产库",
    settings: "设置",
    admin: "管理",
    users: "用户管理",
    applications: "应用管理",
    login: "登录",
  };

  const result: { label: string; href?: string }[] = [];
  let href = "";
  segments.forEach((seg, i) => {
    href += "/" + seg;
    const isLast = i === segments.length - 1;
    const label = labelMap[seg] || seg;
    result.push(isLast ? { label } : { label, href });
  });
  return result;
}

function UserMenu() {
  const user = useCurrentUser();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!user) return null;

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="用户菜单"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
      >
        <span className="grid size-6 place-items-center rounded-full bg-[var(--color-accent)] text-xs font-medium text-white">
          {user.name.slice(0, 1)}
        </span>
        <span className="hidden sm:inline">{user.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-md">
          <div className="px-3 py-1.5 text-xs text-[var(--color-text-muted)]">
            {user.username}
          </div>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <LogOut className="size-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
