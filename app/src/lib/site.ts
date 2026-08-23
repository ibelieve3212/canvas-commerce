/**
 * 站点级配置集中点。品牌名、导航项等可配置项集中于此，
 * 不散落到各页面。AGENTS.md 要求初始品牌使用占位名 CanvasCommerce。
 */
export const site = {
  name: "CanvasCommerce",
  shortName: "CanvasCommerce",
  description: "电商 AI 生图工作台",
  slogan: "把通用生图能力包装成明确任务，稳定产出可发布的电商图",
  url: "http://localhost:3000",
  owner: "CanvasCommerce",
  version: "0.1.0",
} as const;

export type Site = typeof site;

/** 桌面左侧导航项。移动端底栏取前几项，其余进"更多"。 */
export const desktopNav = [
  { href: "/apps", label: "应用中心", icon: "LayoutGrid" },
  { href: "/tasks", label: "任务中心", icon: "ListTodo" },
  { href: "/assets", label: "资产库", icon: "Images" },
  { href: "/chat", label: "聊天", icon: "MessageCircle" },
  { href: "/settings", label: "设置", icon: "Settings" },
] as const;

export const mobileNav = [
  { href: "/apps", label: "应用", icon: "LayoutGrid" },
  { href: "/tasks", label: "任务", icon: "ListTodo" },
  { href: "/assets", label: "资产", icon: "Images" },
  { href: "/chat", label: "聊天", icon: "MessageCircle" },
] as const;

export const adminNav = [
  { href: "/admin/users", label: "用户管理", icon: "Users" },
  { href: "/admin/applications", label: "应用管理", icon: "AppWindow" },
] as const;
