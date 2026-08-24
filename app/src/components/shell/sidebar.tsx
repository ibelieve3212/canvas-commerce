"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { site, desktopNav, adminNav } from "@/lib/site";
import { NamedIcon } from "@/components/ui/icon";
import { useCurrentUser } from "@/app/(app)/user-context";
import { env } from "@/lib/env";

export function Sidebar() {
  const pathname = usePathname();
  const user = useCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  return (
    <aside
      className="hidden lg:flex h-screen w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]"
      aria-label="主导航"
    >
      <div className="flex h-14 items-center px-5">
        <Link href="/apps" className="flex items-center gap-2 font-semibold text-[var(--color-text)]">
          <span className="size-7 grid place-items-center rounded-md bg-[var(--color-accent)] text-sm font-bold text-white">
            C
          </span>
          <span className="text-[15px]">{site.shortName}</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-3">
        <SidebarSection items={desktopNav} pathname={pathname} />
        {isAdmin && (
          <>
            <div className="my-3 border-t border-[var(--color-border)]" />
            <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              管理
            </p>
            <SidebarSection items={adminNav} pathname={pathname} />
          </>
        )}
      </nav>

      <div className="px-5 py-3 text-[11px] text-[var(--color-text-muted)]">
        v{site.version}{env.NODE_ENV !== "production" ? " · 开发模式" : ""}
      </div>
    </aside>
  );
}

function SidebarSection({
  items,
  pathname,
}: {
  items: readonly { href: string; label: string; icon: string }[];
  pathname: string;
}) {
  return (
    <>
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-[var(--color-accent)]/8 font-medium text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]",
            )}
          >
            <NamedIcon name={item.icon} className="size-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
