/**
 * Next.js instrumentation：进程启动时拉起同进程 worker（队列轮询 + 自动清理 tick）。
 *
 * dev 和生产都启动。V2 是单容器单体，没有独立 worker 进程——
 * 若这里不启动，生成任务会永远卡在 queued，自动清理也永不执行。
 *
 * ⚠️ 这里必须按环境分两条加载路径，两种写法互相排斥，不能统一：
 *
 * 1. dev（`next dev --webpack`）：必须用 `new Function` + `createRequire` 把导入链
 *    藏起来。webpack 会把 instrumentation 同时编译成 nodejs 和 edge 两份产物，
 *    edge 那份解析不了 better-sqlite3 里的 `require("fs")`，直接编译报
 *    `Module not found: Can't resolve 'fs'`，整个 dev server 500。
 *    `serverExternalPackages` 管不到 instrumentation 的 edge 编译。
 *
 * 2. 生产（`output: "standalone"`）：必须用普通 import 让打包器看见，
 *    否则 worker 代码不会进 standalone 产物。createRequire 的相对路径基准是
 *    `src/instrumentation.ts`，而 standalone 产物里根本没有 `src/` 目录，
 *    `req("./server/worker/index")` 会 MODULE_NOT_FOUND —— worker 起不来，
 *    生成任务全部永久卡 queued（已实测）。
 *
 * `process.env.NODE_ENV` 被打包器在编译期替换成字面量，所以两个分支各自只在
 * 对应构建里存活，另一个会被死代码消除，不会互相污染。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    if (process.env.NODE_ENV === "production") {
      // 生产：打包器需要看见这个 import 才能把 worker 打进 standalone 产物
      const { startWorker } = await import("@/server/worker");
      startWorker();
      return;
    }

    // dev：对打包器不透明的加载，避开 edge 编译原生模块
    const loadWorker = new Function(
      "moduleUrl",
      `
      return (async () => {
        const { createRequire } = await import("module");
        const req = createRequire(moduleUrl);
        try { req("tsx/cjs"); } catch {}
        return req("./server/worker/index");
      })();
      `,
    ) as (moduleUrl: string) => Promise<{ startWorker: () => void }>;

    const { startWorker } = await loadWorker(import.meta.url);
    startWorker();
  } catch (err) {
    console.error("[instrumentation] worker 启动失败:", err);
  }
}
