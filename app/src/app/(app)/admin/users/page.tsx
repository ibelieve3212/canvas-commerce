"use client";

import * as React from "react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { USERNAME_HINT } from "@/contracts/user";
import { Search, UserPlus, KeyRound, Ban, CheckCircle2, ShieldCheck } from "lucide-react";

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  quota: {
    dailyLimit: number;
    totalQuota: number;
    maxConcurrency: number;
    dailyUsed: number;
    totalUsed: number;
  } | null;
}

export default function AdminUsersPage() {
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [showCreate, setShowCreate] = React.useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/users");
    const json = await res.json();
    if (json.data) setUsers(json.data);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => { void load(); }, []);

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.username.includes(q) || u.name.toLowerCase().includes(q);
  });

  return (
    <>
      <PageHeader title="用户管理" description="创建用户、重置密码、停用与额度调整" />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <Input
            placeholder="搜索用户名或姓名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <UserPlus className="mr-1.5 size-4" />
          创建用户
        </Button>
      </div>

      {showCreate && (
        <CreateUserPanel
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void load(); }}
        />
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">加载中…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">姓名</th>
                <th className="px-3 py-2.5 text-left font-medium">用户名</th>
                <th className="px-3 py-2.5 text-left font-medium">角色</th>
                <th className="px-3 py-2.5 text-left font-medium">状态</th>
                <th className="px-3 py-2.5 text-right font-medium">日额度</th>
                <th className="px-3 py-2.5 text-right font-medium">总额度</th>
                <th className="px-3 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filtered.map((u) => (
                <UserRowItem key={u.id} user={u} onChanged={() => void load()} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function CreateUserPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [username, setUsername] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<"USER" | "ADMIN">("USER");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, name, password, role }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message || "创建失败"); return; }
      toast("success", "用户已创建");
      onCreated();
    } catch { setError("网络错误"); }
    finally { setLoading(false); }
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--color-text)]">创建新用户</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="new-username" required>用户名</Label>
          <Input
            id="new-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="zhangsan"
            autoCapitalize="none"
            spellCheck={false}
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{USERNAME_HINT}</p>
        </div>
        <div>
          <Label htmlFor="new-name" required>姓名</Label>
          <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="张三" />
        </div>
        <div>
          <Label htmlFor="new-pass" required>密码（≥6位）</Label>
          <Input id="new-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••" />
        </div>
        <div>
          <Label htmlFor="new-role">角色</Label>
          <select
            id="new-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "USER" | "ADMIN")}
            className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)]"
          >
            <option value="USER">普通用户</option>
            <option value="ADMIN">管理员</option>
          </select>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} loading={loading} size="sm">创建</Button>
        <Button onClick={onClose} variant="ghost" size="sm">取消</Button>
      </div>
    </div>
  );
}

function UserRowItem({ user, onChanged }: { user: UserRow; onChanged: () => void }) {
  const toast = useToast();
  const [confirmAction, setConfirmAction] = React.useState<null | "reset_password" | "toggle_status">(null);
  const [newPass, setNewPass] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast("success", successMsg);
        onChanged();
      } else {
        const json = await res.json();
        toast("error", json.error?.message || "操作失败");
      }
    } catch {
      toast("error", "网络错误");
    } finally { setBusy(false); }
  }

  return (
    <tr className="bg-[var(--color-surface)]">
      <td className="px-3 py-2.5 font-medium text-[var(--color-text)]">{user.name}</td>
      <td className="px-3 py-2.5 font-mono text-[var(--color-text-muted)]">{user.username}</td>
      <td className="px-3 py-2.5">
        {user.role === "ADMIN" ? (
          <Badge variant="info"><ShieldCheck className="mr-1 size-3" />管理员</Badge>
        ) : (
          <Badge variant="neutral">用户</Badge>
        )}
      </td>
      <td className="px-3 py-2.5">
        {user.status === "ACTIVE" ? (
          <Badge variant="success">正常</Badge>
        ) : (
          <Badge variant="danger">已停用</Badge>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-[var(--color-text-muted)]">
        {user.quota ? `${user.quota.dailyUsed}/${user.quota.dailyLimit}` : "—"}
      </td>
      <td className="px-3 py-2.5 text-right text-[var(--color-text-muted)]">
        {user.quota ? `${user.quota.totalUsed}/${user.quota.totalQuota}` : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {confirmAction === "reset_password" ? (
            <div className="flex items-center gap-1">
              <Input
                type="password"
                placeholder="新密码"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                className="h-7 w-28 text-xs"
              />
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => { void patch({ action: "reset_password", password: newPass }, "密码已重置"); setConfirmAction(null); setNewPass(""); }}
              >
                确认
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setConfirmAction(null); setNewPass(""); }}>取消</Button>
            </div>
          ) : confirmAction === "toggle_status" ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">确认{user.status === "ACTIVE" ? "停用" : "启用"}？</span>
              <Button
                size="sm"
                variant={user.status === "ACTIVE" ? "danger" : "ghost"}
                loading={busy}
                onClick={() => { void patch({ action: "toggle_status", status: user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, user.status === "ACTIVE" ? "已停用" : "已启用"); setConfirmAction(null); }}
              >
                确认
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)}>取消</Button>
            </div>
          ) : (
            <>
              <Tooltip content="重置密码">
                <button
                  type="button"
                  aria-label="重置密码"
                  onClick={() => setConfirmAction("reset_password")}
                  className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                >
                  <KeyRound className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content={user.status === "ACTIVE" ? "停用" : "启用"}>
                <button
                  type="button"
                  aria-label={user.status === "ACTIVE" ? "停用" : "启用"}
                  onClick={() => setConfirmAction("toggle_status")}
                  className="grid size-7 place-items-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                >
                  {user.status === "ACTIVE" ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
