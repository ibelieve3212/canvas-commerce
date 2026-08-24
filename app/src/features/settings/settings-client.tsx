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
import { Eye, EyeOff, Save, Shield, Server, Trash2, Key, RefreshCw, MessageCircle } from "lucide-react";

interface ProviderData {
  userConfig: {
    baseUrl: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    model: string;
  };
  chatConfig?: {
    baseUrl: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    model: string;
    useImageChannel: boolean;
  };
  chatAdminDefault?: { baseUrl: string; hasKey: boolean; model: string } | null;
  adminDefault: { baseUrl: string; hasKey: boolean; model: string } | null;
  isAdmin: boolean;
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


export function SettingsClient({ isAdmin }: { isAdmin: boolean }) {
  const showToast = useToast();
  const router = useRouter();
  const [oldPassword, setOldPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [changingPassword, setChangingPassword] = React.useState(false);

  const [loading, setLoading] = React.useState(true);
  const [quota, setQuota] = React.useState<{ dailyLimit: number; dailyUsed: number; totalQuota: number; totalUsed: number } | null>(null);

  // Provider 配置
  const [providerData, setProviderData] = React.useState<ProviderData | null>(null);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [savingProvider, setSavingProvider] = React.useState(false);
  const [hasExistingKey, setHasExistingKey] = React.useState(false);
  const [keyEditMode, setKeyEditMode] = React.useState(false);
  const [fetchedModels, setFetchedModels] = React.useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = React.useState(false);

  // 管理员默认配置（全局）——生图与聊天各一套
  const [adminBase, setAdminBase] = React.useState("");
  const [adminKey, setAdminKey] = React.useState("");
  const [adminModel, setAdminModel] = React.useState("");
  const [adminChatBase, setAdminChatBase] = React.useState("");
  const [adminChatKey, setAdminChatKey] = React.useState("");
  const [adminChatModel, setAdminChatModel] = React.useState("");
  const [savingAdmin, setSavingAdmin] = React.useState(false);
  const [savingAdminChat, setSavingAdminChat] = React.useState(false);
  /** 全局渠道的"获取模型"结果，与用户级分开存，避免串台 */
  const [adminFetchedModels, setAdminFetchedModels] = React.useState<string[]>([]);
  const [adminChatFetchedModels, setAdminChatFetchedModels] = React.useState<string[]>([]);
  const [fetchingAdminModels, setFetchingAdminModels] = React.useState(false);
  const [fetchingAdminChatModels, setFetchingAdminChatModels] = React.useState(false);
  /** 全局配置区默认折叠——普通用户看不到，管理员也不必每次都面对 */
  const [showGlobalImage, setShowGlobalImage] = React.useState(false);
  const [showGlobalChat, setShowGlobalChat] = React.useState(false);

  /** 聊天渠道来源：与生图相同 / 用全局 / 自定义 */
  const [chatSource, setChatSource] = React.useState<"image" | "global" | "custom">("global");

  // Chat 渠道配置
  const [chatBaseUrl, setChatBaseUrl] = React.useState("");
  const [chatApiKey, setChatApiKey] = React.useState("");
  const [chatModel, setChatModel] = React.useState("gpt-4o");
  const [hasExistingChatKey, setHasExistingChatKey] = React.useState(false);
  const [chatKeyEditMode, setChatKeyEditMode] = React.useState(false);
  const [savingChatProvider, setSavingChatProvider] = React.useState(false);
  const [fetchedChatModels, setFetchedChatModels] = React.useState<string[]>([]);
  const [fetchingChatModels, setFetchingChatModels] = React.useState(false);

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
          // 选中态要反映后端真实回退：勾了复用生图 → image；
          // 自己填了 baseUrl+key → custom；都没有 → 走全局
          setChatSource(
            json.data.chatConfig.useImageChannel
              ? "image"
              : json.data.chatConfig.baseUrl && json.data.chatConfig.hasApiKey
                ? "custom"
                : "global",
          );
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
      const body: Record<string, unknown> = { baseUrl, model };
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
      showToast("success", "Provider 配置已保存");
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
      const body: Record<string, string> = {};
      if (baseUrl) body.baseUrl = baseUrl;
      // apiKey: 如果在编辑模式或首次配置，用输入框的值
      if (apiKey) body.apiKey = apiKey;

      const res = await fetch("/api/me/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "获取模型列表失败");
        return;
      }
      const models = json.data?.models ?? [];
      if (models.length === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setFetchedModels(models);
      showToast("success", `已获取 ${models.length} 个模型`);
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
      const refreshed = await fetch("/api/me/provider").then((r) => r.json());
      if (refreshed.data?.chatAdminDefault) {
        setAdminChatBase(refreshed.data.chatAdminDefault.baseUrl);
        setProviderData(refreshed.data);
      }
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSavingAdminChat(false);
    }
  }

  async function handleSaveChatProvider() {
    setSavingChatProvider(true);
    try {
      const body: Record<string, unknown> = {
        chatModel,
        // 持久化"与生图渠道相同"的选择。此前这是个只填输入框的按钮，
        // 不填 key 就等于没配置，用户点了却仍被提示未配置。
        chatUseImageChannel: chatSource === "image",
      };

      if (chatSource === "custom") {
        body.chatBaseUrl = chatBaseUrl;
        if (hasExistingChatKey && chatKeyEditMode) {
          if (chatApiKey) body.chatApiKey = chatApiKey;
          else body.clearChatApiKey = true;
        } else if (!hasExistingChatKey && chatApiKey) {
          body.chatApiKey = chatApiKey;
        }
      } else {
        // 选了复用生图或全局，清掉用户级 chat 配置，否则它优先级更高会盖住选择
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
        chatSource === "image"
          ? "已设为与生图渠道相同"
          : chatSource === "global"
            ? "已设为使用全局聊天渠道"
            : "Chat 渠道配置已保存",
      );
      setChatApiKey("");
      setChatKeyEditMode(false);
      // 重新加载
      const refreshRes = await fetch("/api/me/provider");
      const refreshJson = await refreshRes.json();
      if (refreshJson.data?.chatConfig) {
        setProviderData(refreshJson.data);
        setChatBaseUrl(refreshJson.data.chatConfig.baseUrl);
        setHasExistingChatKey(refreshJson.data.chatConfig.hasApiKey);
        // 此前漏了这行，保存后模型框会回落到旧值
        setChatModel(refreshJson.data.chatConfig.model || "gpt-4o");
      }
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
      const body: Record<string, string> = { scope: "global" };
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
      const models = json.data?.models ?? [];
      if (models.length === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setModels(models);
      showToast("success", `已获取 ${models.length} 个模型`);
    } catch {
      showToast("error", "网络错误");
    } finally {
      setFetching(false);
    }
  }

  async function handleFetchChatModels() {
    setFetchingChatModels(true);
    try {
      // 用 chat 配置获取模型列表
      const body: Record<string, string> = {};
      body.baseUrl = chatBaseUrl;
      if (chatApiKey) body.apiKey = chatApiKey;

      const res = await fetch("/api/me/provider/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        showToast("error", json.error?.message || "获取模型列表失败");
        return;
      }
      const models = json.data?.models ?? [];
      if (models.length === 0) {
        showToast("error", "模型列表为空");
        return;
      }
      setFetchedChatModels(models);
      showToast("success", `已获取 ${models.length} 个模型`);
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

        {/* 用户级 Provider 配置 */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <Server className="size-4" /> Provider 配置
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            配置后生图将调用真实 API。未配置时使用管理员默认或降级到 Mock。
          </p>

          {/* 当前状态 */}
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-[var(--color-text-muted)]">当前状态</span>
            {baseUrl && hasExistingKey ? (
              <Badge variant="success">已配置（{providerData?.userConfig.apiKeyMasked}）</Badge>
            ) : providerData?.adminDefault?.hasKey ? (
              <Badge variant="neutral">使用管理员默认</Badge>
            ) : (
              <Badge variant="neutral">Mock 模式</Badge>
            )}
          </div>

          <div className="space-y-3 max-w-md">
            <div>
              <Label htmlFor="base-url">Provider Base URL</Label>
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

            {/* 模型选择 */}
            <div>
              <Label htmlFor="model-select">生图模型</Label>
              <div className="flex gap-2">
                {fetchedModels.length > 0 ? (
                  <Select
                    id="model-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {!fetchedModels.includes(model) && <option value={model}>{model}</option>}
                    {fetchedModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select>
                ) : (
                  <Input
                    id="model-select"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="gpt-image-2"
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFetchModels}
                  loading={fetchingModels}
                  className="shrink-0"
                  title="从 Provider 获取可用模型列表"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              {fetchedModels.length > 0 ? (
                <div className="mt-1">
                  <p className="text-xs text-[var(--color-success)]">已获取 {fetchedModels.length} 个模型</p>
                  <button
                    type="button"
                    className="text-xs text-[var(--color-accent)] hover:underline"
                    onClick={() => setFetchedModels([])}
                  >切换为手动输入</button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">填写 Base URL 和 Token 后点刷新按钮获取可用模型</p>
              )}
            </div>

            <Button onClick={handleSaveProvider} loading={savingProvider} size="sm">
              <Save className="mr-1 size-4" /> 保存配置
            </Button>
          </div>

          {/* Base URL 说明 */}
          <div className="mt-2 max-w-md">
            <p className="text-xs text-[var(--color-text-muted)]">
              Base URL 只填域名和端口（如 <code className="rounded bg-[var(--color-surface-subtle)] px-1">http://127.0.0.1:8080</code>），
              系统会自动拼接 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1/images/generations</code> 路径，无需手动加 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1</code>。
            </p>
          </div>
        </section>

        {/* 全局默认生图渠道（仅管理员，折叠） */}
        {isAdmin && (
          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setShowGlobalImage((v) => !v)}
              aria-expanded={showGlobalImage}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Key className="size-4" /> 全局默认生图渠道
                <Badge variant="neutral">管理员</Badge>
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                {providerData?.adminDefault?.baseUrl
                  ? `已配置 · ${providerData.adminDefault.model || "未指定模型"}`
                  : "未配置"}
                {showGlobalImage ? " ▲" : " ▼"}
              </span>
            </button>

            {showGlobalImage && (
              <div className="mt-3">
                <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                  未自行配置生图渠道的用户会用这套。留空则降级到环境变量或 Mock。
                </p>
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
                  <div>
                    <Label htmlFor="admin-model">生图模型</Label>
                    <div className="flex gap-2">
                      {adminFetchedModels.length > 0 ? (
                        <Select id="admin-model" value={adminModel} onChange={(e) => setAdminModel(e.target.value)}>
                          {!adminFetchedModels.includes(adminModel) && <option value={adminModel}>{adminModel}</option>}
                          {adminFetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      ) : (
                        <Input id="admin-model" type="text" value={adminModel} onChange={(e) => setAdminModel(e.target.value)} placeholder="gpt-image-2" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleFetchGlobalModels("image")}
                        loading={fetchingAdminModels}
                        className="shrink-0"
                        title="从全局渠道获取可用模型列表"
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {adminFetchedModels.length > 0 ? (
                        <>已获取 {adminFetchedModels.length} 个模型 · <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => setAdminFetchedModels([])}>切换手动输入</button></>
                      ) : (
                        "已保存过 Token 时可直接点刷新，无需重填"
                      )}
                    </p>
                  </div>
                  <Button onClick={handleSaveAdminDefault} loading={savingAdmin} size="sm">
                    <Save className="mr-1 size-4" /> 保存全局生图渠道
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 聊天渠道 */}
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
            <MessageCircle className="size-4" /> 聊天渠道
          </h2>
          <p className="mb-3 text-xs text-[var(--color-text-muted)]">
            聊天助手用的 API 渠道。需支持 OpenAI 兼容的 <code className="rounded bg-[var(--color-surface-subtle)] px-1">/v1/chat/completions</code> 接口。
          </p>

          {/* 渠道来源单选。把优先级直接画在 UI 上，不再让人猜哪一栏生效。 */}
          <div className="mb-4 space-y-2 max-w-md">
            {([
              { value: "image", label: "与生图渠道相同", hint: "直接复用生图的地址和 Token，无需重复填写" },
              { value: "global", label: "使用全局聊天渠道", hint: providerData?.chatAdminDefault?.baseUrl ? `管理员已配置 · ${providerData.chatAdminDefault.model || "gpt-4o"}` : "管理员尚未配置，会回退到生图渠道" },
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

          <div className="space-y-3 max-w-md">
            {chatSource === "custom" && (
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

            {/* 模型始终要选：生图模型（如 gpt-image-2）不能拿来聊天 */}
            <div>
              <Label htmlFor="chat-model">聊天模型</Label>
              <div className="flex gap-2">
                {fetchedChatModels.length > 0 ? (
                  <Select
                    id="chat-model"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                  >
                    {!fetchedChatModels.includes(chatModel) && <option value={chatModel}>{chatModel}</option>}
                    {fetchedChatModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select>
                ) : (
                  <Input
                    id="chat-model"
                    type="text"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    placeholder="gpt-4o"
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFetchChatModels}
                  loading={fetchingChatModels}
                  className="shrink-0"
                  title="从上游获取可用模型列表"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {fetchedChatModels.length > 0
                  ? <>已获取 {fetchedChatModels.length} 个模型 · <button type="button" className="text-[var(--color-accent)] hover:underline" onClick={() => setFetchedChatModels([])}>切换手动输入</button></>
                  : "支持 vision 的模型可看图（如 gpt-4o）"}
              </p>
            </div>

            <Button onClick={handleSaveChatProvider} loading={savingChatProvider} size="sm">
              <Save className="mr-1 size-4" /> 保存聊天渠道
            </Button>
          </div>

          {/* 全局默认聊天渠道（仅管理员，折叠） */}
          {isAdmin && (
            <div className="mt-4 border-t border-[var(--color-border)] pt-3">
              <button
                type="button"
                onClick={() => setShowGlobalChat((v) => !v)}
                aria-expanded={showGlobalChat}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="flex items-center gap-2 text-xs font-medium text-[var(--color-text)]">
                  <Key className="size-3.5" /> 全局默认聊天渠道
                  <Badge variant="neutral">管理员</Badge>
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {providerData?.chatAdminDefault?.baseUrl ? "已配置" : "未配置"}
                  {showGlobalChat ? " ▲" : " ▼"}
                </span>
              </button>

              {showGlobalChat && (
                <div className="mt-3 space-y-3 max-w-md">
                  <p className="text-xs text-[var(--color-text-muted)]">
                    选了「使用全局聊天渠道」的用户会用这套。留空则回退到生图渠道。
                  </p>
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
                  <div>
                    <Label htmlFor="admin-chat-model">聊天模型</Label>
                    <div className="flex gap-2">
                      {adminChatFetchedModels.length > 0 ? (
                        <Select id="admin-chat-model" value={adminChatModel} onChange={(e) => setAdminChatModel(e.target.value)}>
                          {!adminChatFetchedModels.includes(adminChatModel) && <option value={adminChatModel}>{adminChatModel}</option>}
                          {adminChatFetchedModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                      ) : (
                        <Input id="admin-chat-model" type="text" value={adminChatModel} onChange={(e) => setAdminChatModel(e.target.value)} placeholder="gpt-4o" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleFetchGlobalModels("chat")}
                        loading={fetchingAdminChatModels}
                        className="shrink-0"
                        title="从全局聊天渠道获取可用模型列表"
                      >
                        <RefreshCw className="size-4" />
                      </Button>
                    </div>
                  </div>
                  <Button onClick={handleSaveAdminChatDefault} loading={savingAdminChat} size="sm">
                    <Save className="mr-1 size-4" /> 保存全局聊天渠道
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

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
    </>
  );
}
