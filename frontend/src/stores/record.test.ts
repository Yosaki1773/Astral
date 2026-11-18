import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { listRecords, latestRecords, getRecord, getRecordActivity } from '@/api/record';
import { useAuthStore } from './auth';
import { useTenantStore } from './tenant';
import { useRecordStore } from './record';
import type { Record, RecordListResponse } from '@/types/record';

vi.mock('@/api/record', () => ({
    listRecords: vi.fn(), latestRecords: vi.fn(), getRecord: vi.fn(), getRecordActivity: vi.fn(),
}));
const directory = vi.hoisted(() => ({ loadUsers: vi.fn(), loadModels: vi.fn(), loadVendors: vi.fn() }));
vi.mock('@/stores/directory', () => ({ useDirectoryStore: () => directory }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function response(id: number, total = 50): RecordListResponse {
    return { list: [{ id, user_id: -1, model_id: null, vendor_id: null } as Record], total };
}

describe('record list store', () => {
    let pinia: ReturnType<typeof createPinia>;

    beforeEach(() => {
        localStorage.clear();
        pinia = createPinia();
        setActivePinia(pinia);
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        directory.loadUsers.mockResolvedValue([]);
        directory.loadModels.mockResolvedValue([]);
        directory.loadVendors.mockResolvedValue([]);
    });

    afterEach(() => {
        disposePinia(pinia);
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows manual loading immediately without clearing the previous results', async () => {
        const store = useRecordStore();
        vi.mocked(listRecords).mockResolvedValueOnce(response(1));
        await store.fetchRecords({ page: 3, pageSize: 20 });
        const pending = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        const request = store.fetchRecords({ keyword: 'new', page: 1 });
        expect(store.listLoading).toBe(true);
        expect(store.listFetching).toBe(true);
        expect(store.records[0]?.id).toBe(1);
        expect(store.total).toBe(50);
        pending.resolve(response(2));
        expect(await request).toEqual({ status: 'success', total: 50 });
        expect(store.listLoading).toBe(false);
        expect(store.listFetching).toBe(false);
    });

    it.each([false, true])('delays background loading, slow=%s', async slow => {
        const store = useRecordStore();
        const pending = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        const request = store.fetchRecords({}, { background: true });
        expect(store.listLoading).toBe(false);
        await vi.advanceTimersByTimeAsync(2999);
        expect(store.listLoading).toBe(false);
        if (slow) {
            await vi.advanceTimersByTimeAsync(1);
            expect(store.listLoading).toBe(true);
        }
        pending.resolve({ list: [], total: 0 });
        await request;
        await vi.advanceTimersByTimeAsync(3000);
        expect(store.listLoading).toBe(false);
    });

    it('preserves results, total and successful query on failure without loading directories', async () => {
        const store = useRecordStore();
        const query = { page: 3, pageSize: 20, keyword: 'old' };
        vi.mocked(listRecords).mockResolvedValueOnce(response(1));
        await store.fetchRecords(query);
        query.keyword = 'edited';
        expect(store.lastSuccessfulQuery?.keyword).toBe('old');
        Object.values(directory).forEach(mock => mock.mockClear());
        vi.mocked(listRecords).mockRejectedValueOnce(new Error('503'));
        expect(await store.fetchRecords({ keyword: 'new' })).toEqual({ status: 'failed' });
        expect(store.records[0]?.id).toBe(1);
        expect(store.total).toBe(50);
        expect(store.lastSuccessfulQuery).toEqual({ page: 3, pageSize: 20, keyword: 'old' });
        expect(store.listLoadFailed).toBe(true);
        expect(store.listLoading).toBe(false);
        Object.values(directory).forEach(mock => expect(mock).not.toHaveBeenCalled());
    });

    it('distinguishes initial failure from empty success and keeps the warning until retry succeeds', async () => {
        const store = useRecordStore();
        vi.mocked(listRecords).mockRejectedValueOnce(new Error('503'));
        await store.fetchRecords();
        expect(store.listLoadFailed).toBe(true);
        expect(store.lastSuccessfulQuery).toBeNull();
        const pending = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        const request = store.fetchRecords();
        expect(store.listLoadFailed).toBe(true);
        pending.resolve({ list: [], total: 0 });
        await request;
        expect(store.listLoadFailed).toBe(false);
        expect(store.lastSuccessfulQuery).toEqual({});
        expect(store.total).toBe(0);
        Object.values(directory).forEach(mock => expect(mock).not.toHaveBeenCalled());
    });

    it.each(['success', 'failed'] as const)('ignores an old %s response after a newer success', async outcome => {
        const store = useRecordStore();
        const old = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(2));
        const oldRequest = store.fetchRecords({ keyword: 'old' });
        await store.fetchRecords({ keyword: 'new' });
        Object.values(directory).forEach(mock => mock.mockClear());
        if (outcome === 'success') old.resolve(response(1));
        else old.reject(new Error('old failure'));
        expect(await oldRequest).toEqual({ status: 'stale' });
        expect(store.records[0]?.id).toBe(2);
        expect(store.listLoadFailed).toBe(false);
        expect(store.listLoading).toBe(false);
        Object.values(directory).forEach(mock => expect(mock).not.toHaveBeenCalled());
    });

    it('does not let an old success erase the latest failure', async () => {
        const store = useRecordStore();
        vi.mocked(listRecords).mockResolvedValueOnce(response(1));
        await store.fetchRecords();
        const old = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('new failure'));
        const oldRequest = store.fetchRecords({ keyword: 'old' });
        await store.fetchRecords({ keyword: 'new' });
        old.resolve(response(2));
        await oldRequest;
        expect(store.records[0]?.id).toBe(1);
        expect(store.listLoadFailed).toBe(true);
    });

    it('skips background refresh while fetching and an old completion cannot stop manual loading', async () => {
        const store = useRecordStore();
        const old = deferred<RecordListResponse>();
        const manual = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(old.promise).mockReturnValueOnce(manual.promise);
        const oldRequest = store.fetchRecords({}, { background: true });
        expect(await store.fetchRecords({}, { background: true })).toEqual({ status: 'skipped' });
        expect(listRecords).toHaveBeenCalledTimes(1);
        const manualRequest = store.fetchRecords({ keyword: 'new' });
        old.resolve(response(1));
        await oldRequest;
        expect(store.listLoading).toBe(true);
        await vi.advanceTimersByTimeAsync(3000);
        expect(store.listLoading).toBe(true);
        manual.resolve(response(2));
        await manualRequest;
        expect(store.listLoading).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['clear', 'tenant', 'account', 'logout'])('invalidates retained results and pending responses on %s', async scope => {
        const auth = useAuthStore();
        auth.setToken('first');
        const store = useRecordStore();
        vi.mocked(listRecords).mockResolvedValueOnce(response(1));
        await store.fetchRecords();
        const pending = deferred<RecordListResponse>();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        const request = store.fetchRecords({}, { background: true });
        if (scope === 'clear') store.clearRecords();
        else if (scope === 'tenant') useTenantStore().setTenant('99');
        else if (scope === 'account') auth.setToken('second');
        else auth.logout();
        pending.resolve(response(2));
        expect(await request).toEqual({ status: 'stale' });
        expect(store.records).toEqual([]);
        expect(store.total).toBe(0);
        expect(store.lastSuccessfulQuery).toBeNull();
        expect(store.listLoadFailed).toBe(false);
        expect(store.listFetching).toBe(false);
        await vi.advanceTimersByTimeAsync(3000);
        expect(store.listLoading).toBe(false);
    });

    it('keeps detail and latest loading independent of list requests', async () => {
        const store = useRecordStore();
        const detail = deferred<Record>();
        const latest = deferred<Record[]>();
        const list = deferred<RecordListResponse>();
        vi.mocked(getRecord).mockReturnValueOnce(detail.promise);
        vi.mocked(getRecordActivity).mockResolvedValue({ record_id: 1, activities: [] });
        vi.mocked(latestRecords).mockReturnValueOnce(latest.promise);
        vi.mocked(listRecords).mockReturnValueOnce(list.promise);
        const detailRequest = store.fetchRecordDetail(1);
        const latestRequest = store.fetchLatest();
        const listRequest = store.fetchRecords();
        expect(store.loading).toBe(false);
        expect(store.listLoading).toBe(true);
        await vi.advanceTimersByTimeAsync(3000);
        expect(store.loading).toBe(true);
        list.resolve({ list: [], total: 0 });
        await listRequest;
        expect(store.loading).toBe(true);
        latest.resolve([]);
        await latestRequest;
        expect(store.loading).toBe(true);
        detail.resolve({ id: 1, user_id: null, model_id: null } as Record);
        await detailRequest;
        expect(store.loading).toBe(false);
    });
});
