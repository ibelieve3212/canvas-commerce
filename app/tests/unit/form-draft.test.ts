/**
 * @vitest-environment jsdom
 *
 * 表单草稿本地暂存。
 *
 * 场景：在应用里填了一半，跑去聊天页复制卖点，切回来内容全没了——
 * 表单状态只活在组件里，路由一变就销毁。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFormDraft } from "@/features/generation/use-form-draft";
import type { FormValues } from "@/contracts/generation";

const APP = "app_main_image";
const KEY = `cc:draft:${APP}`;
const defaults: FormValues = { name: "", category: "", platform: "taobao", product: [] };

beforeEach(() => {
  window.localStorage.clear();
});

/** 渲染一次 hook，模拟"进入页面时表单已是某个状态" */
function mount(values: FormValues, count = 3, enabled = true) {
  return renderHook(() => useFormDraft(APP, values, count, defaults, enabled));
}

function readRaw() {
  const raw = window.localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("useFormDraft", () => {
  it("填了内容后写入 localStorage", () => {
    mount({ ...defaults, name: "艾草坐垫" });
    expect(readRaw()?.values.name).toBe("艾草坐垫");
    expect(readRaw()?.requestedCount).toBe(3);
  });

  it("全是默认值时不写入——否则一进页面就留下空草稿", () => {
    mount(defaults);
    expect(readRaw()).toBeNull();
  });

  it("下次挂载能读回草稿", () => {
    mount({ ...defaults, name: "艾草坐垫", category: "养生" });
    const { result } = mount(defaults);
    expect(result.current.restored?.values.name).toBe("艾草坐垫");
    expect(result.current.restored?.values.category).toBe("养生");
  });

  it("图片字段一起恢复：存的是已上传的 uploadId 与服务端 URL", () => {
    // 文件早已上传到服务端，previewUrl 是 /api/storage/... 而非 blob URL，
    // 所以刷新后依然可用——这是图片能整体存进 localStorage 的前提
    const withImage: FormValues = {
      ...defaults,
      name: "坐垫",
      product: [{ uploadId: "u1", objectKey: "uid/a.png", previewUrl: "/api/storage/uid%2Fa.png" }],
    };
    mount(withImage);
    const { result } = mount(defaults);
    const restored = result.current.restored?.values.product as Array<Record<string, string>>;
    expect(restored).toHaveLength(1);
    expect(restored[0].uploadId).toBe("u1");
    expect(restored[0].previewUrl).toBe("/api/storage/uid%2Fa.png");
  });

  it("clear() 后草稿消失（提交成功时调用）", () => {
    const { result } = mount({ ...defaults, name: "坐垫" });
    expect(readRaw()).not.toBeNull();
    result.current.clear();
    expect(readRaw()).toBeNull();
  });

  it("用户把内容清空时草稿也删掉，不会又被恢复出来", () => {
    mount({ ...defaults, name: "坐垫" });
    expect(readRaw()).not.toBeNull();
    // 同一个 app 下把字段清回默认值
    mount(defaults);
    expect(readRaw()).toBeNull();
  });

  it("enabled=false 时既不读也不写（从历史批次恢复参数时）", () => {
    mount({ ...defaults, name: "坐垫" });
    const { result } = mount({ ...defaults, name: "别的" }, 3, false);
    // 不读
    expect(result.current.restored).toBeNull();
    // 也不写——localStorage 里还是上一次那份
    expect(readRaw()?.values.name).toBe("坐垫");
  });

  it("按应用隔离，切换应用不互相覆盖", () => {
    renderHook(() => useFormDraft("app_a", { ...defaults, name: "A" }, 1, defaults, true));
    renderHook(() => useFormDraft("app_b", { ...defaults, name: "B" }, 1, defaults, true));
    expect(JSON.parse(window.localStorage.getItem("cc:draft:app_a")!).values.name).toBe("A");
    expect(JSON.parse(window.localStorage.getItem("cc:draft:app_b")!).values.name).toBe("B");
  });

  it("超过 7 天的草稿视为过期，读不出来且被清掉", () => {
    const stale = {
      values: { ...defaults, name: "很久以前" },
      requestedCount: 3,
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    window.localStorage.setItem(KEY, JSON.stringify(stale));
    const { result } = mount(defaults);
    expect(result.current.restored).toBeNull();
    expect(readRaw()).toBeNull();
  });

  it("localStorage 里是坏数据时不崩，当无草稿处理", () => {
    window.localStorage.setItem(KEY, "{不是合法 JSON");
    const { result } = mount(defaults);
    expect(result.current.restored).toBeNull();
  });

  it("localStorage 不可用时静默降级，不抛错", () => {
    // 隐私模式下 setItem 会抛。草稿是增强功能，不能因此崩页面
    const orig = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => mount({ ...defaults, name: "坐垫" })).not.toThrow();
    window.localStorage.setItem = orig;
  });
});
