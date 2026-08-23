"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { mobileNav, desktopNav, adminNav, site } from "@/lib/site";
import { NamedIcon } from "@/components/ui/icon";

export function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const moreItems = [...desktopNav, ...adminNav].filter(
    (i) => !mobileNav.some((m) => m.href === i.href),
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden"
      aria-label="移动主导航"
    >
      {mobileNav.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)]",
            )}
          >
            <NamedIcon name={item.icon} className="size-5" />
            {item.label}
          </Link>
        );
      })}

      <button
        type="button"
        onClick={() => setMoreOpen((v) => !v)}
        aria-label="更多"
        aria-expanded={moreOpen}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-[var(--color-text-muted)]"
      >
        {moreOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        更多
      </button>

      {moreOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-48 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-md">
          {moreItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
                )}
              >
                <NamedIcon name={item.icon} className="size-4" />
                {item.label}
              </Link>
            );
          })}
          <div className="mt-2 border-t border-[var(--color-border)] px-3 pt-2 text-[11px] text-[var(--color-text-muted)]">
            {site.shortName} v{site.version}
          </div>
        </div>
      )}
    </nav>
  );
}
