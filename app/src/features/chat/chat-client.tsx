"use client";

import * as React from "react";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Send, Trash2, MessageCircle, Loader2, Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl: string | null;
  createdAt: string;
}

export function ChatClient() {
  const showToast = useToast();
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  const [loadingConv, setLoadingConv] = React.useState(false);
  const [pendingImage, setPendingImage] = React.useState<{ base64: string; mimeType: string; preview: string } | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Conversation | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // 加载会话列表
  const fetchConversations = React.useCallback(() => {
    fetch("/api/chat/conversations")
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setConversations(json.data);
      });
  }, []);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // 加载会话消息
  React.useEffect(() => {
    if (!currentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    setLoadingConv(true);
    fetch(`/api/chat/conversations/${currentId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setMessages(json.data);
      })
      .finally(() => setLoadingConv(false));
  }, [currentId]);

  // 滚到底部
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 新建会话
  async function handleNewConversation() {
    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新会话" }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast("error", json.error?.message || "创建会话失败");
      return;
    }
    const newConv = json.data;
    setConversations((prev) => [newConv, ...prev]);
    setCurrentId(newConv.id);
  }

  // 删除会话
  async function handleDeleteConversation() {
    const conv = pendingDelete;
    if (!conv) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/chat/conversations/${conv.id}`, { method: "DELETE" });
      if (!res.ok) {
        showToast("error", "删除失败");
        return;
      }
      showToast("success", "会话已删除");
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));
      setPendingDelete(null);
      if (currentId === conv.id) {
        setCurrentId(null);
        setMessages([]);
      }
    } finally {
      setDeleting(false);
    }
  }

  // 选择图片
  function handleSelectImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast("error", "图片不能超过 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      const mimeType = file.type;
      const preview = reader.result as string;
      setPendingImage({ base64, mimeType, preview });
    };
    reader.readAsDataURL(file);
    // 清空 input 以便重复选同一文件
    e.target.value = "";
  }

  // 发送消息
  async function handleSend() {
    if (!currentId) {
      // 自动新建会话
      await handleNewConversation();
      // 等 state 更新
      await new Promise((r) => setTimeout(r, 100));
    }
    const convId = currentId;
    if (!convId || (!input.trim() && !pendingImage)) return;

    setSending(true);
    setWaiting(true);

    // 先插入用户消息
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: input,
      imageUrl: pendingImage?.preview ?? null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    // 再插入 assistant 空气泡，显示“正在思考…”
    const assistantId = `temp-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", imageUrl: null, createdAt: new Date().toISOString() }]);

    const sendInput = input;
    const sendImage = pendingImage;
    setInput("");
    setPendingImage(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          content: sendInput,
          image: sendImage?.base64,
          imageMimeType: sendImage?.mimeType,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        showToast("error", errJson.error?.message || "发送失败");
        return;
      }

      // SSE 流式接收
      setWaiting(false);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      let assistantContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                const delta = data.choices?.[0]?.delta?.content;
                if (delta) {
                  assistantContent += delta;
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId ? { ...m, content: assistantContent } : m,
                    ),
                  );
                }
              } catch {
                // 非 JSON，跳过
              }
            }
          }
        }
      }
    } catch {
      showToast("error", "网络错误");
    } finally {
      setSending(false);
      setWaiting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="-mx-4 -mt-4 -mb-20 flex h-[calc(100vh-3.5rem)] gap-0 overflow-hidden lg:-mx-6 lg:-mb-6 lg:pl-6">
      {/* 侧边会话列表 */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] sm:flex">
        <div className="p-3">
          <button
            type="button"
            onClick={handleNewConversation}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="size-4" />
            新会话
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">暂无会话</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors cursor-pointer",
                currentId === conv.id
                  ? "bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]",
              )}
              onClick={() => setCurrentId(conv.id)}
            >
              <MessageCircle className="size-4 shrink-0" />
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(conv);
                }}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                aria-label="删除会话"
              >
                <Trash2 className="size-3.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* 主对话区 */}
      <div className="flex flex-1 flex-col">
        {/* 顶部 */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
          <div className="flex items-center gap-2">
            {/* 移动端新建 */}
            <button
              type="button"
              onClick={handleNewConversation}
              className="rounded-lg p-1.5 hover:bg-[var(--color-surface-subtle)] sm:hidden"
              aria-label="新会话"
            >
              <Plus className="size-5" />
            </button>
            <h1 className="text-sm font-medium text-[var(--color-text)]">
              {conversations.find((c) => c.id === currentId)?.title ?? "聊天助手"}
            </h1>
            {sending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                <Loader2 className="size-2.5 animate-spin" />
                {waiting ? "思考中" : "回复中"}
              </span>
            )}
          </div>
          {/* 移动端会话列表入口可后续加 */}
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loadingConv && (
            <div className="grid place-items-center py-8">
              <Loader2 className="size-6 animate-spin text-[var(--color-text-muted)]" />
            </div>
          )}
          {!loadingConv && messages.length === 0 && (
            <div className="grid place-items-center py-16 text-center">
              <MessageCircle className="mb-3 size-12 text-[var(--color-text-muted)]" />
              <p className="text-sm text-[var(--color-text-muted)]">
                发送消息开始对话，或贴图让 AI 分析
              </p>
            </div>
          )}
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3",
                  msg.role === "user" ? "flex-row-reverse" : "",
                )}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                    msg.role === "user"
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]",
                  )}
                >
                  {msg.role === "user" ? "我" : "AI"}
                </div>
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-[var(--color-surface-subtle)] text-[var(--color-text)]",
                  )}
                >
                  {msg.imageUrl && (
                    <div className="mb-2 overflow-hidden rounded">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={msg.imageUrl} alt="用户贴图" className="max-h-48 w-auto object-contain" />
                    </div>
                  )}
                  {msg.content && (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  )}
                  {!msg.content && msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                      <Loader2 className="size-3.5 animate-spin" />
                      {waiting ? "正在思考…" : "正在回复…"}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 输入区 */}
        <div className="border-t border-[var(--color-border)] p-4">
          {/* 贴图预览 */}
          {pendingImage && (
            <div className="mb-2 inline-block relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage.preview} alt="待发送" className="h-20 rounded border border-[var(--color-border)] object-cover" />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -right-2 -top-2 grid size-5 place-items-center rounded-full bg-[var(--color-danger)] text-white"
                aria-label="移除图片"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleSelectImage}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
              aria-label="贴图"
            >
              <ImageIcon className="size-4" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
              rows={1}
              className="max-h-32 min-h-[36px] flex-1 resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || (!input.trim() && !pendingImage)}
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-50"
              aria-label="发送"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="确认删除会话"
        description="该会话的所有消息和贴图将永久删除，且不可恢复。"
        confirmLabel="永久删除"
        loading={deleting}
        onConfirm={handleDeleteConversation}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
