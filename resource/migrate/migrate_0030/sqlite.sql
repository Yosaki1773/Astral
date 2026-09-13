-- model：名字恢复为全局唯一（无论是否启用）。去掉"仅启用时唯一"的条件索引
DROP INDEX IF EXISTS enabled_model_name_index;

-- 建唯一索引前先消除存量重名：旧索引只约束 enable=1 的行（部分索引），且应用层仅在启用时查重，
-- 因此存量库里可能存在同名的禁用模型。保留启用的一条（启用优先，同状态取 id 最小），其余追加
-- -<id> 改名，保证下方 UNIQUE 索引可建。
UPDATE model SET name = name || '-' || id
WHERE id IN (
    SELECT m.id FROM model m
    WHERE EXISTS (
        SELECT 1 FROM model m2
        WHERE m2.name = m.name
          AND (m2.enable > m.enable OR (m2.enable = m.enable AND m2.id < m.id))
    )
);
CREATE UNIQUE INDEX name_index ON model(name);

-- client_config：去掉"每 client 仅一个启用配置"条件索引；改为每 client 内名字唯一。
-- (client, name) 联合索引左前缀仍覆盖按 client 的查询（listByClient / disableAllByClient），
-- 因此原 client_config_client_index 一并删除。
DROP INDEX IF EXISTS client_config_enabled_client_unique;
DROP INDEX IF EXISTS client_config_client_index;

-- 同理消除存量重名：旧约束只管"每 client 至多一个启用配置"，name 不参与唯一性，应用层重命名备份
-- 时也不查重，因此同 client 下可能存在同名备份。保留启用的一条（启用优先，同状态取 id 最小）。
UPDATE client_config SET name = name || '-' || id
WHERE id IN (
    SELECT c.id FROM client_config c
    WHERE EXISTS (
        SELECT 1 FROM client_config c2
        WHERE c2.client = c.client AND c2.name = c.name
          AND (c2.enabled > c.enabled OR (c2.enabled = c.enabled AND c2.id < c.id))
    )
);
CREATE UNIQUE INDEX client_config_client_name_unique ON client_config(client, name);

-- vendor_model：本就存在 UNIQUE(vendor_id, model_id)，其最左前缀已覆盖所有按 vendor_id 的查询，
-- 单独建的 idx_vendor_model_vendor_id 冗余，删除。
DROP INDEX IF EXISTS idx_vendor_model_vendor_id;
