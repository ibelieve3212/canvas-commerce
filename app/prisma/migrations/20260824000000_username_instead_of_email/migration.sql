-- 登录标识符从 email 改为 username。
-- 本项目不发邮件（无 SMTP / nodemailer 依赖），email 只当唯一登录标识用，
-- 强制邮箱格式反而要求填一个真实域名，默认值只能借用别人的域名。改成纯用户名。
--
-- SQLite 3.25+ 支持 RENAME COLUMN，无需重建表，不动其他 40 多个索引与外键。
ALTER TABLE "User" RENAME COLUMN "email" TO "username";

-- 索引名跟着字段名走，否则 prisma migrate dev 会判定 drift。
DROP INDEX "User_email_key";
DROP INDEX "User_email_idx";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_username_idx" ON "User"("username");
