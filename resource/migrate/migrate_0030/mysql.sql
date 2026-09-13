-- model：去掉生成列 enabled_name 与"仅启用唯一"索引，恢复 name 全局唯一
-- （name_index 在 migrate_0005 已 drop，此处重建）
ALTER TABLE model DROP INDEX model_name_index;
ALTER TABLE model DROP INDEX enabled_model_name_index;
ALTER TABLE model DROP COLUMN enabled_name;

-- 建唯一索引前先消除存量重名：旧的 enabled_name 生成列在 enable=0 时为 NULL（NULL 不参与唯一性），
-- 且应用层仅在启用时查重，因此存量库里可能存在同名的禁用模型。保留启用的一条（启用优先，同状态
-- 取 id 最小），其余追加 -<id> 改名，保证下方 UNIQUE 索引可建。
-- （MySQL 不允许 UPDATE 直接引用目标表的子查询，用派生表 dup_ids 包一层规避）
UPDATE `model` SET `name` = CONCAT(`name`, '-', `id`)
WHERE `id` IN (
    SELECT id FROM (
        SELECT m.`id` FROM `model` m
        WHERE EXISTS (
            SELECT 1 FROM `model` m2
            WHERE m2.`name` = m.`name`
              AND (m2.`enable` > m.`enable` OR (m2.`enable` = m.`enable` AND m2.`id` < m.`id`))
        )
    ) AS dup_ids
);
CREATE UNIQUE INDEX `name_index` ON `model` (`name`);

-- client_config：去掉生成列 enabled_client 与"每 client 仅一个启用配置"唯一约束；
-- 改为每 client 内名字唯一。联合索引左前缀覆盖按 client 的查询，故删除原 client 索引。
ALTER TABLE client_config DROP INDEX client_config_client_index;
ALTER TABLE client_config DROP INDEX client_config_enabled_client_unique;
ALTER TABLE client_config DROP COLUMN enabled_client;

-- 同理消除存量重名：旧约束只管"每 client 至多一个启用配置"，name 不参与唯一性，应用层重命名备份
-- 时也不查重，因此同 client 下可能存在同名备份。保留启用的一条（启用优先，同状态取 id 最小）。
UPDATE `client_config` SET `name` = CONCAT(`name`, '-', `id`)
WHERE `id` IN (
    SELECT id FROM (
        SELECT c.`id` FROM `client_config` c
        WHERE EXISTS (
            SELECT 1 FROM `client_config` c2
            WHERE c2.`client` = c.`client` AND c2.`name` = c.`name`
              AND (c2.`enabled` > c.`enabled` OR (c2.`enabled` = c.`enabled` AND c2.`id` < c.`id`))
        )
    ) AS dup_ids
);
CREATE UNIQUE INDEX `client_config_client_name_unique` ON `client_config` (`client`, `name`);

-- vendor_model：本就存在 UNIQUE(vendor_id, model_id)，其最左前缀已覆盖所有按 vendor_id 的查询，
-- 单独建的 idx_vendor_model_vendor_id 冗余，删除。
ALTER TABLE vendor_model DROP INDEX idx_vendor_model_vendor_id;
