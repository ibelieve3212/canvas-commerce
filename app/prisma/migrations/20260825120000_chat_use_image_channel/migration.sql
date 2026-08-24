-- 聊天渠道复用生图渠道的开关。
--
-- 此前设置页有个"沿用图像渠道配置"按钮，但它只把 Base URL 填进输入框，
-- 不填 API Key（key 在后端是脱敏的，前端拿不到明文），要求用户再手输一遍 token。
-- 而 getChatProviderConfig 判定"已配置"要求 baseUrl 和 apiKey 两者都有，
-- 所以只点按钮不补 key 的用户会一直被提示"请配置 chat 渠道"。
--
-- 改成持久化的开关：置 true 后由后端直接复用生图渠道的 baseUrl/apiKey，
-- 用户一次都不用填 key。
ALTER TABLE "User" ADD COLUMN "chatUseImageChannel" BOOLEAN NOT NULL DEFAULT false;
