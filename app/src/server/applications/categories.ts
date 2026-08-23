import type { ApplicationCategory } from "@/contracts/application";

export const categoryLabels: Record<ApplicationCategory, string> = {
  ALL: "全部",
  DETAIL_POSTER: "详情与海报",
  SCENE_MODEL: "场景与模特",
  BATCH: "批量工具",
  IMAGE: "图片处理",
  MINE: "我的应用",
};
