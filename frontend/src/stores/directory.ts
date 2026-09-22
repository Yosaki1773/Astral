import { defineStore } from 'pinia';
import { listUsers } from '@/api/user';
import { listModels } from '@/api/model';
import { listVendors } from '@/api/vendor';
import { normalizeListResponse } from '@/utils/listResponse';
import type { User } from '@/types/user';
import type { Model } from '@/types/model';
import type { Vendor } from '@/types/vendor';

/**
 * 用户 / 模型 / 供应商列表的全局缓存 store。
 *
 * 请求记录等页面需要把 user_id / model_id / vendor_id 映射成名称展示，
 * 此前列表每次进入页面都要重新发 batch 请求逐批补全。这里把三份列表
 * 以 TTL 缓存收敛到一处：TTL 内直接复用内存数据，不产生任何网络请求；
 * 并发调用会去重为同一次请求，失败时退回旧缓存。
 *
 * 数据变更（新建 / 重命名 / 删除用户、模型、供应商）后可调用对应的
 * invalidate 方法强制下次重新拉取；不调用则最多在 TTL 后自动过期。
 */

const CACHE_DURATION_MS = 60000;

function createListSection<T>(fetcher: () => Promise<T[]>) {
    let items: T[] = [];
    let loadedAt = 0;
    let inflight: Promise<T[]> | null = null;

    async function load(force: boolean = false): Promise<T[]> {
        const fresh = items.length > 0 && Date.now() - loadedAt < CACHE_DURATION_MS;
        if (!force && fresh) {
            return items;
        }

        // 请求去重：并发 load 共享同一次网络请求
        if (!inflight) {
            inflight = fetcher()
                .then((list) => {
                    items = list;
                    loadedAt = Date.now();
                    return list;
                })
                .catch((error) => {
                    console.error('[directory] 加载列表失败:', error);
                    return items; // 失败时退回旧缓存（可能为空）
                })
                .finally(() => {
                    inflight = null;
                });
        }
        return inflight;
    }

    function invalidate(): void {
        items = [];
        loadedAt = 0;
    }

    return { load, invalidate };
}

export const useDirectoryStore = defineStore('directory', () => {
    const users = createListSection<User>(async () => normalizeListResponse(await listUsers({ pageSize: 1000 })).list);
    const models = createListSection<Model>(async () => normalizeListResponse(await listModels({ pageSize: 1000 })).list);
    const vendors = createListSection<Vendor>(async () => normalizeListResponse(await listVendors({ pageSize: 1000 })).list);

    return {
        loadUsers: users.load,
        loadModels: models.load,
        loadVendors: vendors.load,
        invalidateUsers: users.invalidate,
        invalidateModels: models.invalidate,
        invalidateVendors: vendors.invalidate,
        invalidateAll(): void {
            users.invalidate();
            models.invalidate();
            vendors.invalidate();
        },
    };
});
