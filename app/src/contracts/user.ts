/**
 * 用户领域契约。
 *
 * 登录标识符是用户名而非邮箱：本项目不发送任何邮件（无 SMTP / nodemailer 依赖），
 * email 字段过去只当唯一标识用。强制邮箱格式会逼着默认账号借用一个真实域名，
 * 没有收益。
 */
import { z } from "zod";

/**
 * 用户名规则：3–32 位，小写字母、数字、下划线、连字符。
 *
 * 限小写是为了避免 Admin 与 admin 被当成两个账号 —— SQLite 的 UNIQUE
 * 默认区分大小写，不限的话会出现视觉上重名的账号。
 * 表单层直接转小写，不给用户制造"为什么我的大写没保留"的困惑。
 */
export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "用户名至少 3 位")
  .max(32, "用户名最多 32 位")
  .regex(/^[a-z0-9_-]+$/, "用户名只能包含小写字母、数字、下划线和连字符");

export type Username = z.infer<typeof UsernameSchema>;

/** 前端即时校验用的提示文案，与后端规则保持一致。 */
export const USERNAME_HINT = "3–32 位，小写字母、数字、下划线或连字符";
