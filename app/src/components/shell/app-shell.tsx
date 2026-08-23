import * as React from "react";
import { cn } from "@/lib/cn";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Topbar } from "./topbar";

/**
 * 桌面：固定左侧导航 + 主内容区。
 * 移动：顶栏 + 底部 4 项导航，其余进“更多”。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 pb-20 pt-4 lg:px-6 lg:pb-6">
          <div className={cn("mx-auto max-w-[1600px]")}>{children}</div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
