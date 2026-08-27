import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { maskApiKey } from "@/server/log/sanitize";

/** GET /api/me/provider — 获取当前用户的 Provider 配置状态 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  const fullUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      providerBaseUrl: true,
      providerApiKey: true,
      providerModel: true,
      useGlobalProvider: true,
      chatBaseUrl: true,
      chatApiKey: true,
      chatModel: true,
      chatUseImageChannel: true,
      useGlobalChat: true,
    },
  });

  // 全局配置：管理员拿明文（他就是填的人），普通用户只拿"是否已配置"。
  // 隐藏/灰显输入框挡不住 F12 或 curl——唯一的防线是后端不发送。
  let adminDefault: { baseUrl: string; hasKey: boolean; model: string } | null = null;
  let chatAdminDefault: { baseUrl: string; hasKey: boolean; model: string } | null = null;
  let globalConfigured = { image: false, chat: false };

  const [base, key, model, chatBase, chatKey, chatModel] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: "provider_base_url" } }),
    prisma.systemSetting.findUnique({ where: { key: "provider_api_key" } }),
    prisma.systemSetting.findUnique({ where: { key: "provider_model" } }),
    prisma.systemSetting.findUnique({ where: { key: "chat_base_url" } }),
    prisma.systemSetting.findUnique({ where: { key: "chat_api_key" } }),
    prisma.systemSetting.findUnique({ where: { key: "chat_model" } }),
  ]);

  globalConfigured = {
    image: !!(base?.value && key?.value),
    chat: !!(chatBase?.value && chatKey?.value),
  };

  if (user.role === "ADMIN") {
    adminDefault = {
      baseUrl: base?.value ?? "",
      hasKey: !!key?.value,
      model: model?.value ?? "gpt-image-2",
    };
    chatAdminDefault = {
      baseUrl: chatBase?.value ?? "",
      hasKey: !!chatKey?.value,
      model: chatModel?.value ?? "gpt-4o",
    };
  }

  return NextResponse.json({
    data: {
      userConfig: {
        baseUrl: fullUser?.providerBaseUrl ?? "",
        hasApiKey: !!fullUser?.providerApiKey,
        apiKeyMasked: fullUser?.providerApiKey ? maskApiKey(fullUser.providerApiKey) : "",
        model: fullUser?.providerModel ?? "",
        useGlobal: fullUser?.useGlobalProvider ?? true,
      },
      chatConfig: {
        baseUrl: fullUser?.chatBaseUrl ?? "",
        hasApiKey: !!fullUser?.chatApiKey,
        apiKeyMasked: fullUser?.chatApiKey ? maskApiKey(fullUser.chatApiKey) : "",
        model: fullUser?.chatModel ?? "",
        useImageChannel: fullUser?.chatUseImageChannel ?? false,
        useGlobal: fullUser?.useGlobalChat ?? true,
      },
      /** 全局是否已配置。所有角色都能拿，但不含 baseUrl/key 明文。 */
      globalConfigured,
      adminDefault,
      chatAdminDefault,
      isAdmin: user.role === "ADMIN",
    },
    requestId,
  });
}

const Body = z.object({
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  model: z.string().max(100).optional(),
  clearApiKey: z.boolean().optional(),
  useGlobalProvider: z.boolean().optional(),
  chatBaseUrl: z.string().max(500).optional(),
  chatApiKey: z.string().max(500).optional(),
  chatModel: z.string().max(100).optional(),
  clearChatApiKey: z.boolean().optional(),
  chatUseImageChannel: z.boolean().optional(),
  useGlobalChat: z.boolean().optional(),
});

/** PUT /api/me/provider — 更新当前用户的 Provider 配置 */
export async function PUT(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }

  try {
    const json = await req.json();
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT" }, requestId }, { status: 400 });
    }

    const data: Record<string, string | boolean | null> = {};
    if (parsed.data.baseUrl !== undefined) data.providerBaseUrl = parsed.data.baseUrl || null;
    if (parsed.data.model !== undefined) data.providerModel = parsed.data.model || null;
    if (parsed.data.apiKey) data.providerApiKey = parsed.data.apiKey;
    if (parsed.data.clearApiKey) data.providerApiKey = null;
    if (parsed.data.useGlobalProvider !== undefined) {
      data.useGlobalProvider = parsed.data.useGlobalProvider;
    }

    // chat 渠道
    if (parsed.data.chatBaseUrl !== undefined) data.chatBaseUrl = parsed.data.chatBaseUrl || null;
    if (parsed.data.chatModel !== undefined) data.chatModel = parsed.data.chatModel || null;
    if (parsed.data.chatApiKey) data.chatApiKey = parsed.data.chatApiKey;
    if (parsed.data.clearChatApiKey) data.chatApiKey = null;
    if (parsed.data.chatUseImageChannel !== undefined) {
      data.chatUseImageChannel = parsed.data.chatUseImageChannel;
    }
    if (parsed.data.useGlobalChat !== undefined) {
      data.useGlobalChat = parsed.data.useGlobalChat;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: "无更新字段" }, requestId }, { status: 400 });
    }

    await prisma.user.update({ where: { id: user.id }, data });

    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    console.error("[me/provider] error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN" }, requestId }, { status: 500 });
  }
}

/** PUT /api/me/provider/admin-default — 管理员设置全局默认 Provider（仅 ADMIN） */
export async function PATCH(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" }, requestId }, { status: 401 });
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: { code: "FORBIDDEN" }, requestId }, { status: 403 });
  }

  try {
    const json = await req.json();
    const parsed = z.object({
      baseUrl: z.string().max(500).optional(),
      apiKey: z.string().max(500).optional(),
      model: z.string().max(100).optional(),
      chatBaseUrl: z.string().max(500).optional(),
      chatApiKey: z.string().max(500).optional(),
      chatModel: z.string().max(100).optional(),
      /**
       * 从管理员自己的个人配置复制 Key 到全局。
       * 前端拿不到 Key 明文（GET 只返回掩码），所以"复用我的个人配置"
       * 按钮只能填 baseUrl/model，Key 必须由服务端自己复制。
       */
      copyKeyFromSelf: z.enum(["image", "chat"]).optional(),
      /** 清除全局配置。取消勾选不清全局（会断掉正在用的人），只有显式点清除才清。 */
      clear: z.enum(["image", "chat"]).optional(),
    }).safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: { code: "INVALID_INPUT" }, requestId }, { status: 400 });
    }

    const updates: { key: string; value: string }[] = [];
    if (parsed.data.baseUrl !== undefined) updates.push({ key: "provider_base_url", value: parsed.data.baseUrl });
    if (parsed.data.apiKey !== undefined) updates.push({ key: "provider_api_key", value: parsed.data.apiKey });
    if (parsed.data.model !== undefined) updates.push({ key: "provider_model", value: parsed.data.model });
    if (parsed.data.chatBaseUrl !== undefined) updates.push({ key: "chat_base_url", value: parsed.data.chatBaseUrl });
    if (parsed.data.chatApiKey !== undefined) updates.push({ key: "chat_api_key", value: parsed.data.chatApiKey });
    if (parsed.data.chatModel !== undefined) updates.push({ key: "chat_model", value: parsed.data.chatModel });

    // 从个人配置复制 Key。放在后面覆盖上面可能传来的空值。
    if (parsed.data.copyKeyFromSelf) {
      const self = await prisma.user.findUnique({
        where: { id: user.id },
        select: { providerApiKey: true, chatApiKey: true, chatUseImageChannel: true },
      });
      const isImage = parsed.data.copyKeyFromSelf === "image";
      // 聊天若勾了"与生图相同"，它自己没有 key，要取生图那把
      const sourceKey = isImage
        ? self?.providerApiKey
        : (self?.chatUseImageChannel ? self?.providerApiKey : self?.chatApiKey);
      if (!sourceKey) {
        return NextResponse.json(
          { error: { code: "NO_SELF_KEY", message: "你的个人配置里没有 API Token，请先填写并保存" }, requestId },
          { status: 400 },
        );
      }
      updates.push({ key: isImage ? "provider_api_key" : "chat_api_key", value: sourceKey });
    }

    // 清除：置空字符串而非删记录，getXxxConfig 判定的是 value 非空
    if (parsed.data.clear === "image") {
      updates.push(
        { key: "provider_base_url", value: "" },
        { key: "provider_api_key", value: "" },
        { key: "provider_model", value: "" },
      );
    }
    if (parsed.data.clear === "chat") {
      updates.push(
        { key: "chat_base_url", value: "" },
        { key: "chat_api_key", value: "" },
        { key: "chat_model", value: "" },
      );
    }

    for (const u of updates) {
      await prisma.systemSetting.upsert({
        where: { key: u.key },
        create: { key: u.key, value: u.value },
        update: { value: u.value },
      });
    }

    return NextResponse.json({ data: { ok: true }, requestId });
  } catch (err) {
    console.error("[me/provider/admin-default] error:", err);
    return NextResponse.json({ error: { code: "UNKNOWN" }, requestId }, { status: 500 });
  }
}
