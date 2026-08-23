"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { site } from "@/lib/site";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") || "/apps";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message || "登录失败");
        return;
      }
      router.push(redirect);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-grid size-10 place-items-center rounded-lg bg-[var(--color-accent)] text-lg font-bold text-white">
            C
          </span>
          <h1 className="mt-3 text-xl font-semibold text-[var(--color-text)]">
            {site.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {site.description}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm"
        >
          <div className="space-y-3">
            <div>
              <Label htmlFor="username" required>
                用户名
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor="password" required>
                密码
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} className="mt-4 w-full" size="lg">
            登录
          </Button>
        </form>

        {/* 演示账号提示只在开发环境显示 —— 生产页面不该印默认口令 */}
        {process.env.NODE_ENV !== "production" && (
          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-3 text-center text-xs text-[var(--color-text-muted)]">
            <p>开发演示账号</p>
            <p className="mt-1">
              管理员 <code className="font-mono">admin</code> / <code className="font-mono">admin123</code>
            </p>
            <p>
              用户 <code className="font-mono">user</code> / <code className="font-mono">user123</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
