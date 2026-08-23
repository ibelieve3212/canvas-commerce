/**
 * 日志脱敏工具：在输出到 console/log 之前对敏感信息打码。
 */

/** 对 API Key / Token 脱敏：只显示前 4 和后 4 位 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return "***";
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

/** 对用户名脱敏：只显示首字母，其余打码 */
export function maskUsername(username: string): string {
  if (!username) return "***";
  if (username.length <= 1) return "***";
  return `${username[0]}***`;
}

/** 对 Base URL 脱敏：保留协议和域名，遮掩路径 */
export function maskBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/***`;
  } catch {
    return "***";
  }
}

/** 递归脱敏对象中的敏感字段（in-place 不可变，返回新对象） */
export function sanitizeForLog<T>(obj: T): T {
  const sensitiveKeys = ["apiKey", "token", "password", "secret", "authorization"];
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForLog) as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        result[key] = "***REDACTED***";
      } else {
        result[key] = sanitizeForLog(value);
      }
    }
    return result as T;
  }
  return obj;
}
