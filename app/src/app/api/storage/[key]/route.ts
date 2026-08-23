/**
 * 本地存储文件访问路由。验证登录后从本地文件系统读取并返回。
 * 带有 X-Content-Type-Options: nosniff 和 Content-Disposition。
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getStorage } from "@/server/storage/adapter";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { key: encodedKey } = await params;
  const objectKey = decodeURIComponent(encodedKey);

  // 验证 key 属于当前用户（兼容 OPT-3 新旧两种路径）
  // 新路径：{userId}/{uuid}.ext
  // 老路径：users/{userId}/{category}/{yyyy}/{mm}/{uuid}.ext
  const userId = user.id;
  const isNewPath = objectKey.startsWith(`${userId}/`);
  const isOldPath = objectKey.startsWith(`users/${userId}/`);
  if (!isNewPath && !isOldPath) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
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
