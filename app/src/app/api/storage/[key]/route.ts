/**
 * 本地存储文件访问路由。验证读权限后从本地文件系统读取并返回。
 * 带有 X-Content-Type-Options: nosniff。
 *
 * 授权规则见 @/server/storage/authorize——三类 objectKey 的归属判断方式不同，
 * 尤其聊天贴图路径里没有 userId，必须查会话表。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getStorage } from "@/server/storage/adapter";
import { authorizeStorageRead } from "@/server/storage/authorize";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { key: encodedKey } = await params;
  const objectKey = decodeURIComponent(encodedKey);

  const auth = await authorizeStorageRead(objectKey, {
    id: user.id,
    role: user.role,
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 403 });
  }

  const storage = getStorage();
  try {
    const buf = await storage.get(objectKey);
    const ext = objectKey.split(".").pop()?.toLowerCase() ?? "";
    const mime =
      ext === "png"
        ? "image/png"
        : ext === "jpg" || ext === "jpeg"
          ? "image/jpeg"
          : ext === "webp"
            ? "image/webp"
            : "application/octet-stream";

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
}
