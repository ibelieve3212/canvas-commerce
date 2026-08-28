import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * 环境变量集中校验。所有业务代码只依赖这里导出的 `env`。
 * 缺少必填项时启动即失败；可选项提供默认值。
 */
export const env = createEnv({
  server: {
    AUTH_SECRET: z.string().min(16),
    APP_URL: z.string().url().default("http://localhost:3000"),

    // 数据库：V2 固定 SQLite，不再支持切换 PostgreSQL
    DATABASE_URL: z.string().default("file:.data/db/dev.db"),

    // 存储：V2 固定本地文件系统，不再支持 S3
    STORAGE_LOCAL_PATH: z.string().default(".data/storage"),

    GENERATION_PROVIDER: z.enum(["mock", "newapi"]).default("mock"),

    CCLOAD_NEW_API_BASE_URL: z.string().optional().default(""),
    CCLOAD_NEW_API_TOKEN: z.string().optional().default(""),
    CCLOAD_IMAGE_MODEL: z.string().default("gpt-image-2"),
    CCLOAD_IMAGE_ENDPOINT_MODE: z.enum(["images", "auto"]).default("images"),
    CCLOAD_CHANNELS: z.string().optional().default(""),

    // 自动清理策略的兜底默认值。
    // 管理员可在设置页覆盖前两项（存 SystemSetting），改完即时生效、无需重启。
    // 这里的值只在 DB 无配置时使用（如全新部署）。
    ASSET_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    MAX_ASSETS_PER_USER: z.coerce.number().int().min(10).default(300),
    CHAT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    FAILED_JOB_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
    CLEANUP_INTERVAL_HOURS: z.coerce.number().int().min(1).default(6),

    // 自动注入 NODE_ENV
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  client: {},
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_LOCAL_PATH: process.env.STORAGE_LOCAL_PATH,
    GENERATION_PROVIDER: process.env.GENERATION_PROVIDER,
    CCLOAD_NEW_API_BASE_URL: process.env.CCLOAD_NEW_API_BASE_URL,
    CCLOAD_NEW_API_TOKEN: process.env.CCLOAD_NEW_API_TOKEN,
    CCLOAD_IMAGE_MODEL: process.env.CCLOAD_IMAGE_MODEL,
    CCLOAD_IMAGE_ENDPOINT_MODE: process.env.CCLOAD_IMAGE_ENDPOINT_MODE,
    CCLOAD_CHANNELS: process.env.CCLOAD_CHANNELS,
    ASSET_RETENTION_DAYS: process.env.ASSET_RETENTION_DAYS,
    MAX_ASSETS_PER_USER: process.env.MAX_ASSETS_PER_USER,
    CHAT_RETENTION_DAYS: process.env.CHAT_RETENTION_DAYS,
    FAILED_JOB_RETENTION_DAYS: process.env.FAILED_JOB_RETENTION_DAYS,
    CLEANUP_INTERVAL_HOURS: process.env.CLEANUP_INTERVAL_HOURS,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

export type Env = typeof env;
