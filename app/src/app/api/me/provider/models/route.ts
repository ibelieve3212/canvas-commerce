import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { env } from "@/lib/env";
import { maskBaseUrl } from "@/server/log/sanitize";
import { z } from "zod";

/**
 * POST /api/me/provider/models
 *
 * 获取可用模型列表。
 * Body 可选传入临时 baseUrl + apiKey（用于保存前先探测）。
 * 如果 body 为空，则按优先级读取已保存的配置。
 *
 * 调用 OpenAI 兼容的 GET /v1/models 接口。
 */
const Body = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
}).optional();

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  try {
    // 解析 body
    let bodyBaseUrl: string | undefined;
    let bodyApiKey: string | undefined;
    try {
      const json = await req.json();
      const parsed = Body.safeParse(json);
      if (parsed.success && parsed.data) {
        bodyBaseUrl = parsed.data.baseUrl;
        bodyApiKey = parsed.data.apiKey;
      }
    } catch {
      // body 为空，忽略
    }

    // 按优先级读取配置
    let baseUrl = bodyBaseUrl ?? "";
    let apiKey = bodyApiKey ?? "";

    if (!baseUrl || !apiKey) {
      const fullUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { providerBaseUrl: true, providerApiKey: true },
      });
      baseUrl = baseUrl || fullUser?.providerBaseUrl || "";
      apiKey = apiKey || fullUser?.providerApiKey || "";
    }

    if (!baseUrl || !apiKey) {
      const [db, dk] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "provider_base_url" } }),
        prisma.systemSetting.findUnique({ where: { key: "provider_api_key" } }),
      ]);
      baseUrl = baseUrl || db?.value || env.CCLOAD_NEW_API_BASE_URL || "";
      apiKey = apiKey || dk?.value || env.CCLOAD_NEW_API_TOKEN || "";
    }

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: { code: "NOT_CONFIGURED", message: "请先填写 Base URL 和 API Token" }, requestId },
        { status: 400 },
      );
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[provider/models] error ${response.status}`, {
        baseUrl: maskBaseUrl(baseUrl),
      });
      const errJson = await response.json().catch(() => null);
      const errMessage = errJson?.error?.message || `HTTP ${response.status}`;
      return NextResponse.json(
        { error: { code: "PROVIDER_ERROR", message: errMessage } , requestId },
        { status: 502 },
      );
    }

    const json = await response.json();

    // OpenAI 兼容格式: { data: [{ id: "model-name", ... }, ...] }
    const models: string[] = Array.isArray(json?.data)
      ? json.data
          .map((m: { id?: string }) => m.id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
          .sort()
      : [];

    return NextResponse.json({ data: { models, count: models.length }, requestId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[provider/models] error:", message);
    return NextResponse.json(
      { error: { code: "UNKNOWN", message: `获取模型列表失败: ${message}` }, requestId },
      { status: 500 },
    );
  }
}
