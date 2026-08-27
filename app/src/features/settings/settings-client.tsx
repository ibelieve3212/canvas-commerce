"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { isLikelyWrongKind as looksWrongKind } from "@/lib/model-kind";
import { Eye, EyeOff, Save, Shield, Server, Trash2, Key, RefreshCw, MessageCircle } from "lucide-react";

interface ProviderData {
  userConfig: {
    baseUrl: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    model: string;
    useGlobal: boolean;
  };
  chatConfig?: {
    baseUrl: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    model: string;
    useImageChannel: boolean;
    useGlobal: boolean;
  };
  /** 全局是否已配置。不含 baseUrl/key，普通用户也能拿。 */
  globalConfigured: { image: boolean; chat: boolean };
  chatAdminDefault?: { baseUrl: string; hasKey: boolean; model: string } | null;
  adminDefault: { baseUrl: string; hasKey: boolean; model: string } | null;
  isAdmin: boolean;
}

/** models 接口的分组结果 */
interface GroupedModels {
  likely: string[];
  other: string[];
}

interface CleanupImpact {
  assets: { total: number; willDelete: number };
  uploads: { total: number; willDelete: number };
}

interface CleanupTickResult {
  expiredAssets: number;
  excessAssets: number;
  expiredUploads: number;
  excessUploads: number;
  failedJobs: number;
  expiredConversations: number;
}

interface CleanupPolicyData {
  retentionDays: number;
  maxItemsPerUser: number;
  chatRetentionDays: number;
  failedJobRetentionDays: number;
  cleanupIntervalHours: number;
  source: { retentionDays: "db" | "env"; maxItemsPerUser: "db" | "env" };
  impact: CleanupImpact;
  limits: { minRetentionDays: number; minMaxItemsPerUser: number };
}


/**
 * 模型选择控件。有分组结果时用 optgroup 下拉（推荐的排前面、其余仍可选），
 * 没有时退化为文本输入。选了明显不匹配用途的模型会给一行浅色提示。
 *
 * 不硬过滤的理由见 lib/model-kind.ts：模型名没有可靠规律，
 * 过滤漏掉一个用户就永远找不到它。
 */
function ModelPicker(props: {
  id: string;
  label: string;
  kind: "image" | "chat";
  value: string;
  onChange: (v: string) => void;
  grouped: GroupedModels | null;
  onClear: () => void;
  onFetch: () => void;
  fetching: boolean;
  placeholder: string;
  hint?: string;
}) {
  const { grouped, value, kind } = props;
  const all = grouped ? [...grouped.likely, ...grouped.other] : [];
  // 与用途明显不符的提示：只在"明显属于另一边"时出现，名字看不出规律的不打扰
  const wrongKind = looksWrongKind(value, kind);

  return (
    <div>
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex gap-2">
        {grouped ? (
          <Select id={props.id} value={value} onChange={(e) => props.onChange(e.target.value)}>
            {!all.includes(value) && value && <option value={value}>{value}</option>}
            {grouped.likely.length > 0 && (
              <optgroup label={kind === "image" ? "生图模型" : "聊天模型"}>
                {grouped.likely.map((m) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            )}
            {grouped.other.length > 0 && (
              <optgroup label="其他">
                {grouped.other.map((m) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            )}
          </Select>
        ) : (
          <Input
            id={props.id}
            type="text"
            value={value}
            onChange={(e) => props.onChange(e.target.value)}
            placeholder={props.placeholder}
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onFetch}
          loading={props.fetching}
          className="shrink-0"
          title="获取可用模型列表"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      {wrongKind && (
        <p className="mt-1 text-xs text-[var(--color-warning)]">
          {kind === "chat"
            ? "这看起来是生图模型，聊天可能不可用"
            : "这看起来是聊天模型，生图可能不可用"}
        </p>
      )}
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        {grouped ? (
          <>已获取 {all.length} 个模型 · <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={props.onClear}>切换手动输入</button></>
        ) : (
          props.hint ?? "填好地址和 Token 后点刷新获取可用模型"
        )}
      </p>
    </div>
  );
}

export function SettingsClient({ isAdmin }: { isAdmin: boolean }) {
  const showToast = useToast();
  const router = useRouter();
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [changingPassword, setChangingPassword] = React.useState(false);

  const [loading, setLoading] = React.useState(true);
  const [quota, setQuota] = React.useState<{ dailyLimit: number; dailyUsed: number; totalQuota: number; totalUsed: number } | null>(null);

  // Provider 配置（生图，用户级）
  const [providerData, setProviderData] = React.useState<ProviderData | null>(null);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [savingProvider, setSavingProvider] = React.useState(false);
  const [hasExistingKey, setHasExistingKey] = React.useState(false);
  const [keyEditMode, setKeyEditMode] = React.useState(false);
  const [fetchedModels, setFetchedModels] = React.useState<GroupedModels | null>(null);
  const [fetchingModels, setFetchingModels] = React.useState(false);
  /** 勾上则生图跟随全局默认渠道，下方输入区收起 */
  const [useGlobalImage, setUseGlobalImage] = React.useState(true);

  // 全局默认配置（仅管理员，独立编辑）
  const [adminBase, setAdminBase] = React.useState("");
  const [adminKey, setAdminKey] = React.useState("");
  const [adminModel, setAdminModel] = React.useState("");
  const [adminChatBase, setAdminChatBase] = React.useState("");
  const [adminChatKey, setAdminChatKey] = React.useState("");
  const [adminChatModel, setAdminChatModel] = React.useState("");
  const [savingAdmin, setSavingAdmin] = React.useState(false);
  const [savingAdminChat, setSavingAdminChat] = React.useState(false);
  /** 全局渠道的"获取模型"结果，与用户级分开存，避免串台 */
  const [adminFetchedModels, setAdminFetchedModels] = React.useState<GroupedModels | null>(null);
  const [adminChatFetchedModels, setAdminChatFetchedModels] = React.useState<GroupedModels | null>(null);
  const [fetchingAdminModels, setFetchingAdminModels] = React.useState(false);
  const [fetchingAdminChatModels, setFetchingAdminChatModels] = React.useState(false);
  /** 待确认的全局配置清除操作 */
  const [pendingClearGlobal, setPendingClearGlobal] = React.useState<"image" | "chat" | null>(null);
  const [clearingGlobal, setClearingGlobal] = React.useState(false);

  // Chat 渠道配置（用户级）
  const [chatBaseUrl, setChatBaseUrl] = React.useState("");
  const [chatApiKey, setChatApiKey] = React.useState("");
  const [chatModel, setChatModel] = React.useState("gpt-4o");
  const [hasExistingChatKey, setHasExistingChatKey] = React.useState(false);
  const [chatKeyEditMode, setChatKeyEditMode] = React.useState(false);
  const [savingChatProvider, setSavingChatProvider] = React.useState(false);
  const [fetchedChatModels, setFetchedChatModels] = React.useState<GroupedModels | null>(null);
  const [fetchingChatModels, setFetchingChatModels] = React.useState(false);
  /** 勾上则聊天跟随全局默认聊天渠道 */
  const [useGlobalChatFlag, setUseGlobalChatFlag] = React.useState(true);
  /** 取消跟随全局后，聊天渠道来源：与生图相同 / 自定义 */
  const [chatSource, setChatSource] = React.useState<"image" | "custom">("image");

  // 清理策略（仅管理员）
  const [cleanupDays, setCleanupDays] = React.useState("30");
  const [cleanupMax, setCleanupMax] = React.useState("300");
  const [cleanupMeta, setCleanupMeta] = React.useState<CleanupPolicyData | null>(null);
  const [savingCleanup, setSavingCleanup] = React.useState(false);
  /** 已算出影响面、等管理员确认的待保存策略 */
  const [pendingCleanup, setPendingCleanup] = React.useState<
    { days: number; max: number; impact: CleanupImpact } | null
  >(null);

   
  React.useEffect(() => {
    fetch("/api/me").then(r => r.json()).then(json => {
      if (json.data) {
        setQuota(json.data.quota);
      }
    });
    fetch("/api/me/provider").then(r => r.json()).then(json => {
      if (json.data) {
        setProviderData(json.data);
        setBaseUrl(json.data.userConfig.baseUrl);
        setHasExistingKey(json.data.userConfig.hasApiKey);
        setModel(json.data.userConfig.model || json.data.adminDefault?.model || "gpt-image-2");
        setUseGlobalImage(json.data.userConfig.useGlobal);
        if (json.data.adminDefault) {
          setAdminBase(json.data.adminDefault.baseUrl);
          setAdminModel(json.data.adminDefault.model || "gpt-image-2");
        }
        if (json.data.chatAdminDefault) {
          setAdminChatBase(json.data.chatAdminDefault.baseUrl);
          setAdminChatModel(json.data.chatAdminDefault.model || "gpt-4o");
        }
        // chat
        if (json.data.chatConfig) {
          setChatBaseUrl(json.data.chatConfig.baseUrl);
          setHasExistingChatKey(json.data.chatConfig.hasApiKey);
          setChatModel(json.data.chatConfig.model || "gpt-4o");
          setUseGlobalChatFlag(json.data.chatConfig.useGlobal);
          // 取消跟随全局后的来源：勾了复用生图 → image，否则自定义
          setChatSource(json.data.chatConfig.useImageChannel ? "image" : "custom");
        }
        setLoading(false);
      }
    });
    if (isAdmin) {
      fetch("/api/admin/cleanup-policy").then(r => r.json()).then(json => {
        if (json.data) {
          setCleanupMeta(json.data);
          setCleanupDays(String(json.data.retentionDays));
          setCleanupMax(String(json.data.maxItemsPerUser));
        }
      }).catch(() => {});
    }
  }, [isAdmin]);

  /** 第一步：校验 + 算影响面，拿到结果后弹确认。真正的保存在 confirmSaveCleanup。 */
  async function handleSaveCleanup() {
    const days = Number.parseInt(cleanupDays, 10);
    const max = Number.parseInt(cleanupMax, 10);
    const minDays = cleanupMeta?.limits.minRetentionDays ?? 1;
    const minMax = cleanupMeta?.limits.minMaxItemsPerUser ?? 10;

    if (!Number.isFinite(days) || days < minDays) {
      showToast("error", `保留天数需是 ≥ ${minDays} 的整数`);
      return;
    }
    if (!Number.isFinite(max) || max < minMax) {
      showToast("error", `数量上限需是 ≥ ${minMax} 的整数`);
      return;
    }

    setSavingCleanup(true);
    try {
      // 先算影响面，再让管理员确认。清理是物理删除且不可恢复，
      // 没有这步预览，填错一位数会静默删掉大量文件。
      const previewRes = await fetch("/api/admin/cleanup-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: days, maxItemsPerUser: max, preview: true }),
      });
      const previewJson = await previewRes.json();
      if (!previewRes.ok) {
        showToast("error", previewJson.error?.message || "校验失败");
        return;
      }
      setPendingCleanup({ days, max, impact: previewJson.data.impact as CleanupImpact });
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingCleanup(false);
    }
  }

  /** 第二步：管理员在确认弹窗点了「保存并执行」。 */
  async function confirmSaveCleanup() {
    const pending = pendingCleanup;
    if (!pending) return;
    setSavingCleanup(true);
    try {
      const res = await fetch("/api/admin/cleanup-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retentionDays: pending.days,
          maxItemsPerUser: pending.max,
          runNow: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "保存失败");
        return;
      }
      const cleaned = json.data.cleaned as CleanupTickResult | null;
      const deleted = cleaned
        ? cleaned.expiredAssets + cleaned.excessAssets + cleaned.expiredUploads + cleaned.excessUploads
        : 0;
      showToast("success", `清理策略已保存，本次已删除 ${deleted} 项`);
      setPendingCleanup(null);

      // 重拉一次，刷新影响预估
      const refreshed = await fetch("/api/admin/cleanup-policy").then(r => r.json());
      if (refreshed.data) setCleanupMeta(refreshed.data);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingCleanup(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      showToast("error", "两次密码不一致");
      return;
    }
    if (newPassword.length < 8) {
      showToast("error", "新密码至少 8 位");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: oldPassword, newPassword }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "修改失败");
        return;
      }
      showToast("success", "密码已修改，请重新登录");
      setOldPassword(""); setNewPassword(""); setConfirmPassword("");
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSaveProvider() {
    setSavingProvider(true);
    try {
      const body: Record<string, unknown> = {
        model,
        useGlobalProvider: useGlobalImage,
      };
      if (!useGlobalImage) {
        body.baseUrl = baseUrl;
        // 保存逻辑：
        // - 已有 key 且进入修改模式：有输入则更新，空输入则清除
        // - 已有 key 且未进入修改模式：不变更 key
        // - 没有已有 key：输入框有值则保存
        if (hasExistingKey && keyEditMode) {
          if (apiKey) body.apiKey = apiKey;
          else body.clearApiKey = true;
        } else if (!hasExistingKey && apiKey) {
          body.apiKey = apiKey;
        }
      }

      const res = await fetch("/api/me/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "保存失败");
        return;
      }
      showToast("success", useGlobalImage ? "已设为使用系统默认生图渠道" : "生图渠道已保存");
      setApiKey("");
      setKeyEditMode(false);
      // 重新加载
      const refreshRes = await fetch("/api/me/provider");
      const refreshJson = await refreshRes.json();
      if (refreshJson.data) {
        setProviderData(refreshJson.data);
        setHasExistingKey(refreshJson.data.userConfig.hasApiKey);
      }
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingProvider(false);
    }
  }

  async function handleFetchModels() {
    setFetchingModels(true);
    try {
      // 构造临时配置：当前表单值 > 已保存配置
      const body: Record<string, string> = { kind: "image" };
      if (baseUrl) body.baseUrl = baseUrl;
      // apiKey: 如果在编辑模式或首次配置，用输入框的值
      if (apiKey) body.apiKey = apiKey;

      const res = await fetch("/api/me/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "获取模型列表失败");
        return;
      }
      const grouped = json.data?.grouped as GroupedModels | null;
      const total = json.data?.count ?? 0;
      if (!grouped || total === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setFetchedModels(grouped);
      showToast("success", `已获取 ${total} 个模型`);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setFetchingModels(false);
    }
  }

  /** 保存全局默认生图渠道（仅管理员）。 */
  async function handleSaveAdminDefault() {
    setSavingAdmin(true);
    try {
      const body: Record<string, string> = {};
      if (adminBase) body.baseUrl = adminBase;
      if (adminKey) body.apiKey = adminKey;
      if (adminModel) body.model = adminModel;

      const res = await fetch("/api/me/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "保存失败");
        return;
      }
      showToast("success", "全局生图渠道已保存");
      setAdminKey("");
      await refreshProviderData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingAdmin(false);
    }
  }

  /**
   * 保存全局默认聊天渠道（仅管理员）。
   *
   * 这块此前完全没有：`handleSaveAdminDefault` 只提交 baseUrl/apiKey/model
   * 三个生图字段，从不提交 chat*，尽管后端 PATCH 一直支持。
   * 于是管理员在全局那栏填的 chat 配置提示"已保存"却从未落库，
   * 聊天时回退查不到，一直提示"请配置 chat 渠道"。
   */
  async function handleSaveAdminChatDefault() {
    setSavingAdminChat(true);
    try {
      const body: Record<string, string> = {};
      if (adminChatBase) body.chatBaseUrl = adminChatBase;
      if (adminChatKey) body.chatApiKey = adminChatKey;
      if (adminChatModel) body.chatModel = adminChatModel;

      if (Object.keys(body).length === 0) {
        showToast("error", "请至少填写 Base URL");
        return;
      }

      const res = await fetch("/api/me/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "保存失败");
        return;
      }
      showToast("success", "全局聊天渠道已保存");
      setAdminChatKey("");
      await refreshProviderData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingAdminChat(false);
    }
  }

  /** 重新拉取并同步所有渠道相关状态。保存后统一走这里，避免各处漏回填。 */
  async function refreshProviderData() {
    const json = await fetch("/api/me/provider").then((r) => r.json());
    if (!json.data) return;
    setProviderData(json.data);
    setHasExistingKey(json.data.userConfig.hasApiKey);
    setUseGlobalImage(json.data.userConfig.useGlobal);
    if (json.data.adminDefault) {
      setAdminBase(json.data.adminDefault.baseUrl);
      setAdminModel(json.data.adminDefault.model || "gpt-image-2");
    }
    if (json.data.chatAdminDefault) {
      setAdminChatBase(json.data.chatAdminDefault.baseUrl);
      setAdminChatModel(json.data.chatAdminDefault.model || "gpt-4o");
    }
    if (json.data.chatConfig) {
      setChatBaseUrl(json.data.chatConfig.baseUrl);
      setHasExistingChatKey(json.data.chatConfig.hasApiKey);
      setChatModel(json.data.chatConfig.model || "gpt-4o");
      setUseGlobalChatFlag(json.data.chatConfig.useGlobal);
      setChatSource(json.data.chatConfig.useImageChannel ? "image" : "custom");
    }
  }

  /**
   * 把管理员自己的个人配置复制到全局。
   *
   * Key 不经前端：GET 只返回掩码，明文拿不到。所以这里只填 baseUrl/model，
   * 让后端用 copyKeyFromSelf 从管理员的用户记录里直接复制 Key。
   */
  async function handleCopySelfToGlobal(kind: "image" | "chat") {
    const setSaving = kind === "image" ? setSavingAdmin : setSavingAdminChat;
    setSaving(true);
    try {
      const body: Record<string, string> = { copyKeyFromSelf: kind };
      if (kind === "image") {
        body.baseUrl = baseUrl;
        body.model = model;
      } else {
        // 聊天若选了"与生图相同"，地址也应取生图那套
        body.chatBaseUrl = chatSource === "image" ? baseUrl : chatBaseUrl;
        body.chatModel = chatModel;
      }

      const res = await fetch("/api/me/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "复用失败");
        return;
      }
      showToast("success", "已复用个人配置到全局默认");
      await refreshProviderData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSaving(false);
    }
  }

  /** 清除全局配置。取消勾选不清全局（会断掉正在用的人），只有显式点清除才清。 */
  async function handleClearGlobal() {
    const kind = pendingClearGlobal;
    if (!kind) return;
    setClearingGlobal(true);
    try {
      const res = await fetch("/api/me/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: kind }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "清除失败");
        return;
      }
      showToast("success", kind === "image" ? "全局生图渠道已清除" : "全局聊天渠道已清除");
      if (kind === "image") {
        setAdminBase("");
        setAdminKey("");
      } else {
        setAdminChatBase("");
        setAdminChatKey("");
      }
      setPendingClearGlobal(null);
      await refreshProviderData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setClearingGlobal(false);
    }
  }

  async function handleSaveChatProvider() {
    setSavingChatProvider(true);
    try {
      const body: Record<string, unknown> = {
        chatModel,
        useGlobalChat: useGlobalChatFlag,
        chatUseImageChannel: !useGlobalChatFlag && chatSource === "image",
      };

      if (!useGlobalChatFlag && chatSource === "custom") {
        body.chatBaseUrl = chatBaseUrl;
        if (hasExistingChatKey && chatKeyEditMode) {
          if (chatApiKey) body.chatApiKey = chatApiKey;
          else body.clearChatApiKey = true;
        } else if (!hasExistingChatKey && chatApiKey) {
          body.chatApiKey = chatApiKey;
        }
      } else {
        // 跟随全局或复用生图时清掉用户级 chat 配置，否则它优先级更高会盖住选择
        body.chatBaseUrl = "";
        body.clearChatApiKey = true;
      }

      const res = await fetch("/api/me/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "保存失败");
        return;
      }
      showToast(
        "success",
        useGlobalChatFlag
          ? "已设为使用系统默认聊天渠道"
          : chatSource === "image"
            ? "已设为与生图渠道相同"
            : "聊天渠道已保存",
      );
      setChatApiKey("");
      setChatKeyEditMode(false);
      await refreshProviderData();
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingChatProvider(false);
    }
  }

  /** 全局渠道的"获取模型"。scope=global 让后端只读全局那对值，不回落用户级。 */
  async function handleFetchGlobalModels(kind: "image" | "chat") {
    const setFetching = kind === "image" ? setFetchingAdminModels : setFetchingAdminChatModels;
    const setModels = kind === "image" ? setAdminFetchedModels : setAdminChatFetchedModels;
    setFetching(true);
    try {
      const body: Record<string, string> = { scope: "global", kind };
      const base = kind === "image" ? adminBase : adminChatBase;
      const key = kind === "image" ? adminKey : adminChatKey;
      if (base) body.baseUrl = base;
      // key 为空时后端用库里已存的那把，所以这里不强制要求先填
      if (key) body.apiKey = key;

      const res = await fetch("/api/me/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "获取模型列表失败");
        return;
      }
      const grouped = json.data?.grouped as GroupedModels | null;
      const total = json.data?.count ?? 0;
      if (!grouped || total === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setModels(grouped);
      showToast("success", `已获取 ${total} 个模型`);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchChatModels() {
    setFetchingChatModels(true);
    try {
      const body: Record<string, string> = { kind: "chat" };
      // 选了"与生图相同"时，模型列表要从生图那个渠道拉
      const base = chatSource === "image" ? baseUrl : chatBaseUrl;
      if (base) body.baseUrl = base;
      const key = chatSource === "image" ? apiKey : chatApiKey;
      if (key) body.apiKey = key;

      const res = await fetch("/api/me/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "获取模型列表失败");
        return;
      }
      const grouped = json.data?.grouped as GroupedModels | null;
      const total = json.data?.count ?? 0;
      if (!grouped || total === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setFetchedChatModels(grouped);
      showToast("success", `已获取 ${total} 个模型`);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setFetchingChatModels(false);
    }
  }


  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">加载中…</p>;

  return (
    <>
      <PageHeader title="设置" description="账户安全、配额与 Provider 配置" />

      <div className="space-y-6">
        {/* 配额概览 */}
        {quota && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-medium text-[var(--color-text)]">配额概览</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">今日剩余</p>
                <p className="text-lg font-semibold text-[var(--color-text)]">{Math.max(0, quota.dailyLimit - quota.dailyUsed)} / {quota.dailyLimit}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">今日已用</p>
                <p className="text-lg font-semibold text-[var(--color-text)]">{quota.dailyUsed}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">总量剩余</p>
                <p className="text-lg font-semibold text-[var(--color-text)]">{Math.max(0, quota.totalQuota - quota.totalUsed)} / {quota.totalQuota}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">总量已用</p>
                <p className="text-lg font-semibold text-[var(--color-text)]">{quota.totalUsed}</p>
              </div>
            </div>
          </section>
        )}

        {/* 修改密码 */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <Shield className="size-4" /> 修改密码
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">修改后需重新登录</p>
          <div className="space-y-3 max-w-md">
            <div>
              <Label htmlFor="old-pw">当前密码</Label>
              <Input id="old-pw" type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" />
            </div>
            <div>
              <Label htmlFor="new-pw">新密码（至少 8 位）</Label>
              <Input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <Label htmlFor="confirm-pw">确认新密码</Label>
              <Input id="confirm-pw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <Button onClick={handleChangePassword} loading={changingPassword} size="sm">
              <Save className="mr-1 size-4" /> 确认修改
            </Button>
          </div>
        </section>

        {/* 生图渠道（用户级） */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <Server className="size-4" /> 生图渠道
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            生图调用的 API 渠道。未配置且系统也没有默认渠道时降级到 Mock。
          </p>

          {/* 当前状态 */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">当前状态</span>
            {useGlobalImage ? (
              providerData?.globalConfigured.image ? (
                <Badge variant="success">使用系统默认渠道</Badge>
              ) : (
                <Badge variant="neutral">Mock 模式（系统默认未配置）</Badge>
              )
            ) : baseUrl && hasExistingKey ? (
              <Badge variant="success">已配置（{providerData?.userConfig.apiKeyMasked}）</Badge>
            ) : (
              <Badge variant="warning">尚未填写完整</Badge>
            )}
          </div>

          {/* 跟随全局开关。勾上则整个输入区收起——不渲染而非灰显，
              因为全局的 baseUrl/key 后端对普通用户根本不返回。 */}
          <label className="mb-3 flex max-w-md cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-border)] p-2.5 hover:bg-[var(--color-surface-subtle)]">
            <input
              type="checkbox"
              checked={useGlobalImage}
              onChange={(e) => setUseGlobalImage(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-medium text-[var(--color-text)]">使用系统默认生图渠道</span>
              <span className="block text-xs text-[var(--color-text-muted)]">
                由管理员配置，无需自行填写
                {providerData?.globalConfigured.image === false && "（当前尚未配置）"}
              </span>
            </span>
          </label>

          {!useGlobalImage && (
            <div className="space-y-3 max-w-md">
              <div>
                <Label htmlFor="base-url">Base URL</Label>
                <Input
                  id="base-url"
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:8080"
                />
              </div>

              {/* API Key */}
              <div>
                <Label htmlFor="api-key">API Token</Label>
                {hasExistingKey && !keyEditMode ? (
                  <div className="flex items-center gap-2">
                    <Input
                      id="api-key"
                      type="text"
                      value={providerData?.userConfig.apiKeyMasked ?? "***"}
                      disabled
                    />
                    <Button variant="ghost" size="sm" onClick={() => { setKeyEditMode(true); setApiKey(""); }} className="shrink-0">
                      <Key className="mr-1 size-4" /> 修改
                    </Button>
                    <Button variant="ghost" size="sm" onClick={async () => {
                      await fetch("/api/me/provider", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ clearApiKey: true }),
                      });
                      setHasExistingKey(false);
                      setKeyEditMode(false);
                      showToast("success", "API Token 已清除");
                    }} className="shrink-0 text-[var(--color-danger)]">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="api-key"
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)} className="shrink-0">
                      {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 模型始终可选：即使跟随全局，也允许自己指定用哪个模型 */}
          <div className="mt-3 space-y-3 max-w-md">
            <ModelPicker
              id="model-select"
              label="生图模型"
              kind="image"
              value={model}
              onChange={setModel}
              grouped={fetchedModels}
              onClear={() => setFetchedModels(null)}
              onFetch={handleFetchModels}
              fetching={fetchingModels}
              placeholder="gpt-image-2"
              hint={useGlobalImage ? "留空则用系统默认模型" : undefined}
            />

            <Button onClick={handleSaveProvider} loading={savingProvider} size="sm">
              <Save className="mr-1 size-4" /> 保存生图渠道
            </Button>
          </div>

          {!useGlobalImage && (
            <div className="mt-2 max-w-md">
              <p className="text-xs text-[var(--color-text-muted)]">
                Base URL 只填域名和端口（如 <code className="rounded bg-[var(--color-surface-subtle)] px-1">http://127.0.0.1:8080</code>），
                系统会自动拼接 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1/images/generations</code> 路径，无需手动加 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1</code>。
              </p>
            </div>
          )}
        </section>

        {/* 聊天渠道（用户级） */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <MessageCircle className="size-4" /> 聊天渠道
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            聊天助手用的 API 渠道。需支持 OpenAI 兼容的 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1/chat/completions</code> 接口。
          </p>

          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">当前状态</span>
            {useGlobalChatFlag ? (
              providerData?.globalConfigured.chat ? (
                <Badge variant="success">使用系统默认渠道</Badge>
              ) : providerData?.globalConfigured.image ? (
                <Badge variant="neutral">回退到系统生图渠道</Badge>
              ) : (
                <Badge variant="warning">系统默认未配置</Badge>
              )
            ) : chatSource === "image" ? (
              <Badge variant="success">与生图渠道相同</Badge>
            ) : chatBaseUrl && hasExistingChatKey ? (
              <Badge variant="success">已配置（{providerData?.chatConfig?.apiKeyMasked}）</Badge>
            ) : (
              <Badge variant="warning">尚未填写完整</Badge>
            )}
          </div>

          <label className="mb-3 flex max-w-md cursor-pointer items-start gap-2 rounded-lg border border-[var(--color-border)] p-2.5 hover:bg-[var(--color-surface-subtle)]">
            <input
              type="checkbox"
              checked={useGlobalChatFlag}
              onChange={(e) => setUseGlobalChatFlag(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-xs font-medium text-[var(--color-text)]">使用系统默认聊天渠道</span>
              <span className="block text-xs text-[var(--color-text-muted)]">
                由管理员配置，无需自行填写
                {providerData?.globalConfigured.chat === false && "（当前未配置，会回退到系统生图渠道）"}
              </span>
            </span>
          </label>

          {/* 取消跟随全局后才需要选来源。只有两个选项——"用全局"已经由上面的
              勾选框表达了，再放进单选组会让同一件事有两个入口。 */}
          {!useGlobalChatFlag && (
            <div className="mb-4 space-y-2 max-w-md">
              {([
                { value: "image", label: "与生图渠道相同", hint: "复用生图的地址和 Token，无需重复填写" },
                { value: "custom", label: "自定义", hint: "单独为聊天填一套地址和 Token" },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors",
                    chatSource === opt.value
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-subtle)]",
                  )}
                >
                  <input
                    type="radio"
                    name="chat-source"
                    value={opt.value}
                    checked={chatSource === opt.value}
                    onChange={() => setChatSource(opt.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-medium text-[var(--color-text)]">{opt.label}</span>
                    <span className="block text-xs text-[var(--color-text-muted)]">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="space-y-3 max-w-md">
            {!useGlobalChatFlag && chatSource === "custom" && (
              <>
                <div>
                  <Label htmlFor="chat-base-url">Chat Base URL</Label>
                  <Input
                    id="chat-base-url"
                    type="text"
                    value={chatBaseUrl}
                    onChange={(e) => setChatBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8080"
                  />
                </div>
                <div>
                  <Label htmlFor="chat-api-key">Chat API Token</Label>
                  {hasExistingChatKey && !chatKeyEditMode ? (
                    <div className="flex items-center gap-2">
                      <Input
                        id="chat-api-key"
                        type="text"
                        value={providerData?.chatConfig?.apiKeyMasked ?? "***"}
                        disabled
                      />
                      <Button variant="ghost" size="sm" onClick={() => { setChatKeyEditMode(true); setChatApiKey(""); }} className="shrink-0">
                        <Key className="mr-1 size-4" /> 修改
                      </Button>
                      <Button variant="ghost" size="sm" onClick={async () => {
                        await fetch("/api/me/provider", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ clearChatApiKey: true }),
                        });
                        setHasExistingChatKey(false);
                        setChatKeyEditMode(false);
                        showToast("success", "Chat API Token 已清除");
                      }} className="shrink-0 text-[var(--color-danger)]">
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        id="chat-api-key"
                        type={showKey ? "text" : "password"}
                        value={chatApiKey}
                        onChange={(e) => setChatApiKey(e.target.value)}
                        placeholder="sk-..."
                      />
                      <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)} className="shrink-0">
                        {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 模型始终要选：生图模型（如 gpt-image-2）不能拿来聊天，
                所以即使"与生图渠道相同"也不能连模型一起复用 */}
            <ModelPicker
              id="chat-model"
              label="聊天模型"
              kind="chat"
              value={chatModel}
              onChange={setChatModel}
              grouped={fetchedChatModels}
              onClear={() => setFetchedChatModels(null)}
              onFetch={handleFetchChatModels}
              fetching={fetchingChatModels}
              placeholder="gpt-4o"
              hint="支持 vision 的模型可看图（如 gpt-4o）"
            />

            <Button onClick={handleSaveChatProvider} loading={savingChatProvider} size="sm">
              <Save className="mr-1 size-4" /> 保存聊天渠道
            </Button>
          </div>
        </section>

        {/* 全局默认生图渠道（仅管理员，独立编辑） */}
        {isAdmin && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <Key className="size-4" /> 全局默认生图渠道
              <Badge variant="neutral">管理员</Badge>
            </h2>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              勾选了「使用系统默认生图渠道」的用户会用这套。留空则降级到环境变量或 Mock。
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={providerData?.globalConfigured.image ? "success" : "neutral"}>
                {providerData?.globalConfigured.image ? "已配置" : "未配置"}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => handleCopySelfToGlobal("image")} loading={savingAdmin}>
                复用我的个人配置
              </Button>
              {providerData?.globalConfigured.image && (
                <Button variant="ghost" size="sm" onClick={() => setPendingClearGlobal("image")} className="text-[var(--color-danger)]">
                  <Trash2 className="mr-1 size-4" /> 清除
                </Button>
              )}
            </div>

            <div className="space-y-3 max-w-md">
              <div>
                <Label htmlFor="admin-base">Base URL</Label>
                <Input id="admin-base" type="text" value={adminBase} onChange={(e) => setAdminBase(e.target.value)} placeholder="http://api.example.com" />
              </div>
              <div>
                <Label htmlFor="admin-key">API Token</Label>
                <div className="flex gap-2">
                  <Input id="admin-key" type={showKey ? "text" : "password"} value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder={providerData?.adminDefault?.hasKey ? "已配置（输入覆盖）" : "sk-..."} />
                  <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)} className="shrink-0">
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
              <ModelPicker
                id="admin-model"
                label="生图模型"
                kind="image"
                value={adminModel}
                onChange={setAdminModel}
                grouped={adminFetchedModels}
                onClear={() => setAdminFetchedModels(null)}
                onFetch={() => handleFetchGlobalModels("image")}
                fetching={fetchingAdminModels}
                placeholder="gpt-image-2"
                hint="已保存过 Token 时可直接点刷新，无需重填"
              />
              <Button onClick={handleSaveAdminDefault} loading={savingAdmin} size="sm">
                <Save className="mr-1 size-4" /> 保存全局生图渠道
              </Button>
            </div>
          </section>
        )}

        {/* 全局默认聊天渠道（仅管理员，独立编辑） */}
        {isAdmin && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <Key className="size-4" /> 全局默认聊天渠道
              <Badge variant="neutral">管理员</Badge>
            </h2>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              勾选了「使用系统默认聊天渠道」的用户会用这套。留空则回退到全局生图渠道。
            </p>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge variant={providerData?.globalConfigured.chat ? "success" : "neutral"}>
                {providerData?.globalConfigured.chat ? "已配置" : "未配置"}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => handleCopySelfToGlobal("chat")} loading={savingAdminChat}>
                复用我的个人配置
              </Button>
              {providerData?.globalConfigured.chat && (
                <Button variant="ghost" size="sm" onClick={() => setPendingClearGlobal("chat")} className="text-[var(--color-danger)]">
                  <Trash2 className="mr-1 size-4" /> 清除
                </Button>
              )}
            </div>

            <div className="space-y-3 max-w-md">
              <div>
                <Label htmlFor="admin-chat-base">Base URL</Label>
                <Input id="admin-chat-base" type="text" value={adminChatBase} onChange={(e) => setAdminChatBase(e.target.value)} placeholder="http://api.example.com" />
              </div>
              <div>
                <Label htmlFor="admin-chat-key">API Token</Label>
                <div className="flex gap-2">
                  <Input id="admin-chat-key" type={showKey ? "text" : "password"} value={adminChatKey} onChange={(e) => setAdminChatKey(e.target.value)} placeholder={providerData?.chatAdminDefault?.hasKey ? "已配置（输入覆盖）" : "sk-..."} />
                  <Button variant="ghost" size="sm" onClick={() => setShowKey(!showKey)} className="shrink-0">
                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>
              <ModelPicker
                id="admin-chat-model"
                label="聊天模型"
                kind="chat"
                value={adminChatModel}
                onChange={setAdminChatModel}
                grouped={adminChatFetchedModels}
                onClear={() => setAdminChatFetchedModels(null)}
                onFetch={() => handleFetchGlobalModels("chat")}
                fetching={fetchingAdminChatModels}
                placeholder="gpt-4o"
                hint="已保存过 Token 时可直接点刷新，无需重填"
              />
              <Button onClick={handleSaveAdminChatDefault} loading={savingAdminChat} size="sm">
                <Save className="mr-1 size-4" /> 保存全局聊天渠道
              </Button>
            </div>
          </section>
        )}

        {/* 存储与清理策略（仅管理员） */}
        {isAdmin && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
              <Trash2 className="size-4" /> 存储与自动清理（全局）
            </h2>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              生成资产和上传图共用这两个阈值，但各自独立计数。超出时从最早的开始删，
              <strong>收藏图片不豁免</strong>。删除为物理删除，不可恢复。
              清理每 {cleanupMeta?.cleanupIntervalHours ?? 6} 小时自动执行一次。
            </p>
            <div className="space-y-3 max-w-md">
              <div>
                <Label htmlFor="cleanup-days">保留天数</Label>
                <Input
                  id="cleanup-days"
                  type="number"
                  min={cleanupMeta?.limits.minRetentionDays ?? 1}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(e.target.value)}
                  placeholder="30"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  超过该天数的图片自动删除（最小 {cleanupMeta?.limits.minRetentionDays ?? 1} 天）。
                  聊天记录单独按 {cleanupMeta?.chatRetentionDays ?? 30} 天保留。
                </p>
              </div>
              <div>
                <Label htmlFor="cleanup-max">每用户数量上限</Label>
                <Input
                  id="cleanup-max"
                  type="number"
                  min={cleanupMeta?.limits.minMaxItemsPerUser ?? 10}
                  value={cleanupMax}
                  onChange={(e) => setCleanupMax(e.target.value)}
                  placeholder="300"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  资产、上传图各自上限（最小 {cleanupMeta?.limits.minMaxItemsPerUser ?? 10} 张）。微调结果也计入资产数。
                </p>
              </div>

              {cleanupMeta && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                  <div className="mb-1 font-medium text-[var(--color-text)]">当前存量与影响</div>
                  <div>
                    资产共 {cleanupMeta.impact.assets.total} 张，按当前设置待清理{" "}
                    <strong className={cleanupMeta.impact.assets.willDelete > 0 ? "text-[var(--color-warning)]" : ""}>
                      {cleanupMeta.impact.assets.willDelete}
                    </strong>{" "}
                    张
                  </div>
                  <div>
                    上传图共 {cleanupMeta.impact.uploads.total} 张，按当前设置待清理{" "}
                    <strong className={cleanupMeta.impact.uploads.willDelete > 0 ? "text-[var(--color-warning)]" : ""}>
                      {cleanupMeta.impact.uploads.willDelete}
                    </strong>{" "}
                    张
                  </div>
                  <div className="mt-1">
                    数值来源：保留天数 {cleanupMeta.source.retentionDays === "db" ? "设置页" : "环境变量默认"}
                    ，数量上限 {cleanupMeta.source.maxItemsPerUser === "db" ? "设置页" : "环境变量默认"}
                  </div>
                </div>
              )}

              <Button onClick={handleSaveCleanup} loading={savingCleanup} size="sm">
                <Save className="mr-1 size-4" /> 保存并立即清理
              </Button>
            </div>
          </section>
        )}
      </div>

      {/* 清理策略确认。数字来自 preview 接口，与 worker 实际执行同源。 */}
      <ConfirmDialog
        open={pendingCleanup !== null}
        title="确认清理策略"
        description={
          pendingCleanup && (
            <>
              <p className="mb-2">
                保留 {pendingCleanup.days} 天，每用户最多 {pendingCleanup.max} 张
                （资产、上传图各自计算）。
              </p>
              <p className="mb-1">按此设置，下次清理将删除：</p>
              <ul className="mb-2 list-inside list-disc">
                <li>
                  资产{" "}
                  <strong className="text-[var(--color-danger)]">
                    {pendingCleanup.impact.assets.willDelete}
                  </strong>{" "}
                  / {pendingCleanup.impact.assets.total} 张
                </li>
                <li>
                  上传图{" "}
                  <strong className="text-[var(--color-danger)]">
                    {pendingCleanup.impact.uploads.willDelete}
                  </strong>{" "}
                  / {pendingCleanup.impact.uploads.total} 张
                </li>
              </ul>
              <p>
                {pendingCleanup.impact.assets.willDelete + pendingCleanup.impact.uploads.willDelete > 0
                  ? "文件将从服务器永久删除，不可恢复（收藏图片不豁免）。"
                  : "当前无需删除任何内容。"}
              </p>
            </>
          )
        }
        confirmLabel="保存并执行"
        loading={savingCleanup}
        onConfirm={confirmSaveCleanup}
        onCancel={() => setPendingCleanup(null)}
      />

      {/* 清除全局配置确认。会影响所有跟随全局的用户，不是只影响自己。 */}
      <ConfirmDialog
        open={pendingClearGlobal !== null}
        title={pendingClearGlobal === "image" ? "确认清除全局生图渠道" : "确认清除全局聊天渠道"}
        description={
          <>
            清除后，所有勾选了「使用系统默认
            {pendingClearGlobal === "image" ? "生图" : "聊天"}渠道」的用户将
            {pendingClearGlobal === "image"
              ? "降级到 Mock 模式，无法真实生图。"
              : "回退到全局生图渠道；若它也没配置，聊天将不可用。"}
          </>
        }
        confirmLabel="清除"
        loading={clearingGlobal}
        onConfirm={handleClearGlobal}
        onCancel={() => setPendingClearGlobal(null)}
      />
    </>
  );
}
