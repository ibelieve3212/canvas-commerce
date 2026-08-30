/**
 * 存储对象的读取授权。
 *
 * 三类 objectKey，来源不同、归属判断方式也不同：
 *   1. `{userId}/{uuid}.ext`          —— 生成图、微调图、上传图、导出图（makeObjectKey）
 *   2. `users/{userId}/...`           —— OPT-3 精简前的老路径，仍有存量数据
 *   3. `chat/{conversationId}/{uuid}` —— 聊天贴图，路径里根本没有 userId
 *
 * 此前 route 里只按前缀比对 1 和 2，导致两个实测 bug：
 *   - 聊天贴图一律 403。对话进行中前端显示的是 FileReader 的 base64 预览，
 *     所以当时不裂；切走再回来重新拉接口拿到 /api/storage/chat/...，当场全裂。
 *   - 管理员存储页跨用户展示全库资产，但请求别人的图必然 403。
 *     本地只有一个账号所以看不出来，服务器上多用户环境全裂。
 *
 * 抽成独立模块是为了能用真实库单测——route 依赖 next/headers 的 cookies()，
 * 在测试里绕不过去。
 */
import { prisma } from "@/server/db/client";

export interface StorageRequester {
  id: string;
  role: "USER" | "ADMIN";
}

export type StorageAuthResult =
  | { ok: true }
  | { ok: false; reason: "FORBIDDEN" };

const FORBIDDEN: StorageAuthResult = { ok: false, reason: "FORBIDDEN" };

/**
 * 从聊天贴图 key 里取出 conversationId。
 * 形如 `chat/{conversationId}/{uuid}.ext`；段数不足则返回 null。
 */
function conversationIdOf(objectKey: string): string | null {
  const parts = objectKey.split("/");
  if (parts.length < 3 || parts[0] !== "chat") return null;
  const convId = parts[1];
  return convId.length > 0 ? convId : null;
}

/**
 * 判断 requester 能否读取 objectKey 指向的文件。
 *
 * 注意：只管授权，不管文件是否存在——不存在由调用方按 404 处理。
 */
export async function authorizeStorageRead(
  objectKey: string,
  requester: StorageRequester,
): Promise<StorageAuthResult> {
  // 聊天贴图：路径里没有 userId，只能查会话表验归属。
  //
  // 管理员在这里不放行：聊天是私人对话，比商品图敏感得多，
  // 而管理端唯一需要看图的地方（存储页）只列 Asset 表，
  // 聊天贴图存在 ChatMessage.imageObjectKey，从来不在那个列表里。
  // 也就是说放开它不带来任何功能收益。
  if (objectKey.startsWith("chat/")) {
    const conversationId = conversationIdOf(objectKey);
    if (!conversationId) return FORBIDDEN;

    const conv = await prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    // 会话不存在时同样报 403 而非 404：不泄漏"这个 id 存在过"
    if (!conv || conv.userId !== requester.id) return FORBIDDEN;
    return { ok: true };
  }

  // 自己的图，新老两种路径都放行
  if (
    objectKey.startsWith(`${requester.id}/`) ||
    objectKey.startsWith(`users/${requester.id}/`)
  ) {
    return { ok: true };
  }

  // 管理员可读任意用户的生成/上传产物。
  // 管理员存储页的用途就是浏览后决定删哪些，看不到画面这个页面没有意义；
  // 且管理员本来就能通过 /api/admin/storage 看到元数据并批量删除。
  if (requester.role === "ADMIN") return { ok: true };

  return FORBIDDEN;
}
