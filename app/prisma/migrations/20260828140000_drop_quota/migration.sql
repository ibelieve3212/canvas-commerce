-- 移除配额系统。
--
-- 配额从一开始就是给"多人共用一个部署"设计的，实际使用中这个项目
-- 只有少数几个人在用，每次生成前先算一遍额度、批次结束再退还未用部分，
-- 引入的是纯粹的复杂度：预占/结算两阶段、批次删除时要补退还
-- （否则删掉排队中的批次会永久吞掉额度）、事务里多一次写。
--
-- 直接 DROP 而不是留表不用：留下两张不再读写的表，以后看到只会疑惑。
-- 丢掉的只有计数（dailyUsed/totalUsed）与上限配置，
-- 图片、批次、用户账号都不在这两张表里。
--
-- QuotaReservation 的外键是 CASCADE（见 20260824120000），
-- 先删它再删 UserQuota，不会留下悬空引用。
DROP INDEX IF EXISTS "QuotaReservation_status_idx";
DROP INDEX IF EXISTS "QuotaReservation_userId_idx";
DROP INDEX IF EXISTS "QuotaReservation_batchId_key";
DROP TABLE IF EXISTS "QuotaReservation";

DROP INDEX IF EXISTS "UserQuota_dailyDate_idx";
DROP TABLE IF EXISTS "UserQuota";
