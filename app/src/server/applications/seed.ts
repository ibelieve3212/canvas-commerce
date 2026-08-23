/**
 * 内置应用定义（seed）。
 * 以 TypeScript 常量形式定义，阶段2起会通过 prisma seed 持久化。
 * 规则：不复用参考截图中的品牌、文案；用 CanvasCommerce 独立占位文案。
 */
import type { Application } from "@/contracts/application";
import { mainImageApp } from "./apps/main-image";
import { detailPageApp } from "./apps/detail-page";
import { buyerShowApp } from "./apps/buyer-show";
import { posterApp } from "./apps/poster";

export const builtinApplications: Application[] = [
  mainImageApp,
  detailPageApp,
  buyerShowApp,
  posterApp,
];

export function getApplicationBySlug(slug: string): Application | undefined {
  return builtinApplications.find((a) => a.slug === slug);
}

export function getApplicationById(id: string): Application | undefined {
  return builtinApplications.find((a) => a.id === id);
}
