ALTER TABLE vendor ADD COLUMN last_called_at BIGINT NULL;

-- 旧 record 只能识别最终供应商，故障切换中的较早尝试无法完整回填。
UPDATE vendor SET last_called_at = (
    SELECT CAST(strftime('%s', MAX(COALESCE(start_at, created_at))) AS INTEGER) * 1000
    FROM record WHERE record.vendor_id = vendor.id
);

CREATE INDEX idx_vendor_tenant_last_called ON vendor (tenant_id, last_called_at, id);
