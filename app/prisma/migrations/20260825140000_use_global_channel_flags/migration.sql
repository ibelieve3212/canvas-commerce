-- "跟随全局默认渠道"的显式开关（生图 / 聊天各一个）。
--
-- 此前判断依据是"用户级字段为空即跟随全局"，这是个隐式规则：
-- 用户取消勾选、还没填完就刷新页面，勾选框会自己跳回勾上，状态不稳定；
-- 而且界面上完全看不出"留空等于用默认"。
--
-- 默认 true：现存用户绝大多数没填过自己的渠道，跟随全局是他们当前的实际行为，
-- 置 true 保持语义不变。已填过自己配置的用户会在下一段 UPDATE 里被改回 false。
ALTER TABLE "User" ADD COLUMN "useGlobalProvider" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "useGlobalChat" BOOLEAN NOT NULL DEFAULT true;

-- 已经配了自己渠道的用户，实际行为是用自己的那套，开关要置 false，
-- 否则升级后他们会被静默切到全局配置上。
UPDATE "User" SET "useGlobalProvider" = false
WHERE "providerBaseUrl" IS NOT NULL AND "providerApiKey" IS NOT NULL;

-- 聊天同理。勾了"复用生图渠道"的也算已自行配置，不该跟随全局。
UPDATE "User" SET "useGlobalChat" = false
WHERE ("chatBaseUrl" IS NOT NULL AND "chatApiKey" IS NOT NULL)
   OR "chatUseImageChannel" = true;
