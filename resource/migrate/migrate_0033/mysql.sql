ALTER TABLE `vendor` ADD COLUMN `last_called_at` BIGINT NULL;

-- 旧 record 只能识别最终供应商，故障切换中的较早尝试无法完整回填。
UPDATE `vendor` SET `last_called_at` = (
    SELECT TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', MAX(COALESCE(start_at, created_at))) DIV 1000
    FROM `record` WHERE `record`.`vendor_id` = `vendor`.`id`
);

CREATE INDEX `idx_vendor_tenant_last_called` ON `vendor` (`tenant_id`, `last_called_at`, `id`);
