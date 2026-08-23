import { describe, it, expect } from "vitest";
import { maskApiKey, maskUsername, maskBaseUrl, sanitizeForLog } from "@/server/log/sanitize";

describe("日志脱敏", () => {
  it("maskApiKey: 保留前4后4", () => {
    expect(maskApiKey("sk-abcdef1234567890")).toBe("sk-a***7890");
    expect(maskApiKey("short")).toBe("***");
    expect(maskApiKey("")).toBe("***");
  });

  it("maskUsername: 只显示首字母", () => {
    expect(maskUsername("admin")).toBe("a***");
    expect(maskUsername("a")).toBe("***");
    expect(maskUsername("")).toBe("***");
  });

  it("maskBaseUrl: 保留协议和域名", () => {
    expect(maskBaseUrl("http://10.0.0.1:8080/v1/images")).toBe("http://10.0.0.1:8080/***");
    expect(maskBaseUrl("invalid")).toBe("***");
  });

  it("sanitizeForLog: 递归脱敏敏感字段", () => {
    const input = {
      apiKey: "sk-secret",
      token: "bearer-xyz",
      password: "123456",
      normal: "hello",
      nested: {
        authorization: "Bearer abc",
        safe: "ok",
      },
      list: [{ secret: "s", name: "test" }],
    };

    const result = sanitizeForLog(input);
    expect(result.apiKey).toBe("***REDACTED***");
    expect(result.token).toBe("***REDACTED***");
    expect(result.password).toBe("***REDACTED***");
    expect(result.normal).toBe("hello");
    expect(result.nested!.authorization).toBe("***REDACTED***");
    expect(result.nested!.safe).toBe("ok");
    expect(result.list![0].secret).toBe("***REDACTED***");
    expect(result.list![0].name).toBe("test");
  });
});
