"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "cc:favorites";

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}

// useSyncExternalStore 需要稳定快照；用序列化字符串做缓存避免无限循环
// null 表示"缓存已失效"，必须重新读取
let cachedSnapshot: string | null = null;
let cachedSet: Set<string> = new Set();

function getSnapshot(): Set<string> {
  const next = readFavorites();
  const sig = [...next].sort().join(",");
  if (sig !== cachedSnapshot) {
    cachedSnapshot = sig;
    cachedSet = next;
  }
  return cachedSet;
}

function getServerSnapshot(): Set<string> {
  return new Set();
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function notify() {
  cachedSnapshot = null; // 强制下次 getSnapshot 重新读取
  for (const cb of listeners) cb();
}

function writeFavorites(next: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // ignore
  }
  notify();
}

export function useFavorites() {
  const favorites = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const toggle = useCallback((id: string) => {
    const current = readFavorites();
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeFavorites(next);
  }, []);

  return { favorites, toggle, hydrated };
}
