/**
 * 表单草稿本地暂存。
 *
 * 场景：在应用里填了一半，跑去聊天页复制卖点，切回来发现全没了。
 * 表单状态只活在组件里，路由一变就销毁。
 *
 * 只用 localStorage，不落服务端——这是"临时离开一下"的诉求，
 * 不需要跨设备，也不该为此加表和接口。
 *
 * 能整体存下来的前提是 values 全部可 JSON 序列化：图片字段存的是
 * { uploadId, objectKey, previewUrl } 三个字符串（文件早已上传到服务端，
 * previewUrl 是 /api/storage/... 而非 blob URL），所以刷新后依然可用。
 */
import * as React from "react";
import type { FormValues } from "@/contracts/generation";

const KEY_PREFIX = "cc:draft:";
/** 草稿保留时长。超过就当过期丢弃，免得几周后回来看到一堆陈旧内容。 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Draft {
  values: FormValues;
  requestedCount: number;
  savedAt: number;
}

function keyOf(appId: string): string {
  return `${KEY_PREFIX}${appId}`;
}

/** localStorage 在隐私模式/禁用 cookie 时会抛，草稿是增强功能，不能因此崩页面。 */
function safeRead(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed || typeof parsed !== "object" || !parsed.values) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeWrite(key: string, draft: Draft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 配额满或被禁用，静默放弃——草稿丢了不影响主流程
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 同上
  }
}

/** 判断草稿里是否真有用户填过的东西，全是默认值就没必要提示"已恢复"。 */
function hasUserInput(values: FormValues, defaults: FormValues): boolean {
  for (const [k, v] of Object.entries(values)) {
    const d = defaults[k];
    if (Array.isArray(v)) {
      if (v.length > 0) return true;
      continue;
    }
    if (v === undefined || v === null || v === "") continue;
    if (v !== d) return true;
  }
  return false;
}

export interface FormDraftApi {
  /** 页面挂载时读到的草稿；无草稿或无有效内容时为 null。 */
  restored: Draft | null;
  /** 提交成功后调用，清掉这份草稿。 */
  clear: () => void;
}

/**
 * 读取一次草稿（仅挂载时），并持续把当前表单写回 localStorage。
 *
 * @param appId    按应用隔离，切换应用不会互相覆盖
 * @param values   当前表单值
 * @param requestedCount 当前选择的生成数量
 * @param defaults 该应用的默认值，用于判断"是否真填过东西"
 * @param enabled  false 时既不读也不写（如正从历史批次恢复参数时）
 */
export function useFormDraft(
  appId: string,
  values: FormValues,
  requestedCount: number,
  defaults: FormValues,
  enabled: boolean,
): FormDraftApi {
  const key = keyOf(appId);

  // useState 惰性初始化：渲染期执行但合法（不同于直接读 ref）。
  //
  // 注意它只在首次挂载跑一次，所以调用方必须保证 enabled 在首帧就是准的。
  // 生成页用 useSearchParams 读 fromBatch 正是为此——若用挂载时读
  // window.location 的写法，从任务中心点"恢复配置"（客户端路由跳转、
  // 组件先渲染 URL 后更新）会误判成"不是批次恢复"，草稿就把批次参数盖掉了。
  const [restored] = React.useState<Draft | null>(() => {
    if (!enabled || typeof window === "undefined") return null;
    const draft = safeRead(key);
    if (!draft) return null;
    return hasUserInput(draft.values, defaults) ? draft : null;
  });

  // 写入不用防抖：localStorage 是同步 API，写一个几 KB 的对象耗时微秒级，
  // 而防抖会让"填完立刻切页面"这个最典型的场景丢掉最后一次输入。
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    if (!hasUserInput(values, defaults)) {
      // 用户把内容清空了，草稿也该跟着消失，否则下次进来又被"恢复"出来
      safeRemove(key);
      return;
    }
    safeWrite(key, { values, requestedCount, savedAt: Date.now() });
  }, [enabled, key, values, requestedCount, defaults]);

  const clear = React.useCallback(() => {
    if (typeof window === "undefined") return;
    safeRemove(key);
  }, [key]);

  return { restored, clear };
}
