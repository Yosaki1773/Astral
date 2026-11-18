import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { defineComponent, h, onMounted } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { flushPromises, mount } from '@vue/test-utils';
import dayjs from 'dayjs';
import { useAuthStore } from '@/stores/auth';
import { useTenantStore } from '@/stores/tenant';
import { reactive } from 'vue';
import type { RecordQuery } from '@/types/record';
import { useRecordTable } from './useRecordTable';

const fetchRecords = vi.fn();
const clearRecords = vi.fn();
const recordStore = reactive({
    fetchRecords,
    clearRecords,
    lastSuccessfulQuery: null as RecordQuery | null,
    total: 0,
});

vi.mock('@/stores/record', () => ({
    useRecordStore: () => recordStore,
}));

describe('useRecordTable', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        fetchRecords.mockReset();
        clearRecords.mockReset();
        recordStore.lastSuccessfulQuery = null;
        recordStore.total = 0;
        fetchRecords.mockResolvedValue({ status: 'success', total: 42 });
    });

    it('builds record queries from form and pagination state', async () => {
        const recordTable = useRecordTable();

        recordTable.searchForm.status = 'success';
        recordTable.searchForm.user_ids = [1, 2];
        recordTable.searchForm.model_ids = [3];
        recordTable.searchForm.keyword = '关键字 "hello"';
        recordTable.pagination.current = 3;
        recordTable.pagination.pageSize = 20;

        await recordTable.loadData();

        expect(fetchRecords).toHaveBeenCalledWith({
            page: 3,
            pageSize: 20,
            status: 'success',
            user_ids: '1,2',
            model_ids: '3',
            keyword: '关键字 "hello"',
            start_time: undefined,
            end_time: undefined,
        }, undefined);
        expect(recordTable.pagination.total).toBe(42);
    });

    it('searches from the first page while preserving the keyword and selected filters', () => {
        const recordTable = useRecordTable();
        recordTable.pagination.current = 4;
        recordTable.searchForm.keyword = '搜索 "内容"';
        recordTable.searchForm.user_ids = [5];

        recordTable.handleSearch();

        expect(recordTable.pagination.current).toBe(1);
        expect(clearRecords).not.toHaveBeenCalled();
        expect(fetchRecords).toHaveBeenCalledWith(expect.objectContaining({
            page: 1,
            keyword: '搜索 "内容"',
            user_ids: '5',
        }), undefined);
    });

    it.each(['list navigation', 'browser back'])('preserves filters and pagination after viewing a detail and returning via %s', async (returnMethod) => {
        let recordTable!: ReturnType<typeof useRecordTable>;
        const List = defineComponent({
            setup() {
                recordTable = useRecordTable();
                onMounted(() => { void recordTable.loadData(); });
                return () => h('div');
            },
        });
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/record', name: 'RecordList', component: List },
                { path: '/record/:id', name: 'RecordDetail', component: { render: () => h('div') } },
            ],
        });
        await router.push({ name: 'RecordList' });
        const wrapper = mount(RouterView, { global: { plugins: [createPinia(), router] } });

        try {
            await flushPromises();
            const original = recordTable;
            original.searchForm.status = 'success';
            original.searchForm.user_ids = [-1, 5];
            original.searchForm.model_ids = [10, 11];
            original.searchForm.keyword = '搜索 "内容"';
            const dates: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs('2026-03-21 10:00:00'), dayjs('2026-03-21 11:00:00')];
            original.dateRange.value = dates;
            original.handleDateChange(dates);
            original.handleTableChange({ current: 4, pageSize: 20 });
            await flushPromises();
            const expectedQuery = fetchRecords.mock.lastCall![0];
            expect(original.pagination.total).toBe(42);

            await router.push({ name: 'RecordDetail', params: { id: '123' } });
            await flushPromises();
            if (returnMethod === 'browser back') {
                router.back();
            } else {
                await router.push({ name: 'RecordList' });
            }
            await flushPromises();

            expect(recordTable).not.toBe(original);
            expect(recordTable.searchForm).toEqual(original.searchForm);
            expect(recordTable.dateRange.value?.map(date => date.format('YYYY-MM-DD HH:mm:ss')))
                .toEqual(['2026-03-21 10:00:00', '2026-03-21 11:00:00']);
            expect(recordTable.pagination.current).toBe(4);
            expect(recordTable.pagination.pageSize).toBe(20);
            expect(recordTable.pagination.total).toBe(42);
            expect(fetchRecords).toHaveBeenLastCalledWith(expectedQuery, undefined);
        } finally {
            wrapper.unmount();
        }
    });

    it.each(['tenant', 'account', 'logout'])('clears saved list state when the %s changes', (scope) => {
        const authStore = useAuthStore();
        authStore.setToken('first-account');
        const recordTable = useRecordTable();
        recordTable.searchForm.keyword = '旧账号内容';
        recordTable.searchForm.user_ids = [5];
        recordTable.searchForm.model_ids = [10];
        const dates: [dayjs.Dayjs, dayjs.Dayjs] = [dayjs('2026-03-21 10:00:00'), dayjs('2026-03-21 11:00:00')];
        recordTable.dateRange.value = dates;
        recordTable.handleDateChange(dates);
        recordTable.pagination.current = 4;
        recordTable.pagination.pageSize = 50;
        recordTable.pagination.total = 120;

        if (scope === 'tenant') {
            useTenantStore().setTenant('99');
        } else if (scope === 'account') {
            authStore.setToken('second-account');
        } else {
            authStore.logout();
        }

        expect(recordTable.searchForm.keyword).toBeUndefined();
        const restored = useRecordTable();
        expect(Object.values(restored.searchForm).every(value => value === undefined)).toBe(true);
        expect(restored.dateRange.value).toBeNull();
        expect(restored.pagination.current).toBe(1);
        expect(restored.pagination.pageSize).toBe(10);
        expect(restored.pagination.total).toBe(0);
    });

    it.each(['search', 'reset', 'page'])('keeps the last successful pagination after a failed %s', async action => {
        const recordTable = useRecordTable();
        recordTable.pagination.current = 3;
        recordTable.pagination.pageSize = 20;
        recordTable.pagination.total = 50;
        recordStore.lastSuccessfulQuery = { page: 3, pageSize: 20, keyword: 'old' };
        recordStore.total = 50;
        recordTable.searchForm.keyword = 'new';
        fetchRecords.mockResolvedValueOnce({ status: 'failed' });

        if (action === 'search') recordTable.handleSearch();
        else if (action === 'reset') recordTable.handleReset();
        else recordTable.handleTableChange({ current: 4, pageSize: 10 });
        await flushPromises();

        expect(clearRecords).not.toHaveBeenCalled();
        expect(recordTable.pagination.total).toBe(50);
        expect(recordTable.displayPagination.value).toMatchObject({ current: 3, pageSize: 20, total: 50 });
        expect(recordTable.searchForm.keyword).toBe(action === 'reset' ? undefined : 'new');
    });

    it.each(['stale', 'skipped'])('does not update pagination for a %s result', async status => {
        const recordTable = useRecordTable();
        recordTable.pagination.total = 50;
        fetchRecords.mockResolvedValueOnce({ status });
        await recordTable.loadData();
        expect(recordTable.pagination.total).toBe(50);
    });

    it('passes background mode explicitly and shows pagination for the successful query', async () => {
        const recordTable = useRecordTable();
        recordTable.pagination.current = 2;
        await recordTable.loadData({ background: true });
        expect(fetchRecords).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), { background: true });
        recordStore.lastSuccessfulQuery = { page: 2, pageSize: 10 };
        recordStore.total = 42;
        expect(recordTable.displayPagination.value).toMatchObject({ current: 2, pageSize: 10, total: 42 });
    });

    it('resets filters and pagination before reloading data', () => {
        const recordTable = useRecordTable();

        recordTable.searchForm.status = 'failed';
        recordTable.searchForm.user_ids = [5];
        recordTable.searchForm.model_ids = [10, 11];
        recordTable.searchForm.keyword = '历史内容';
        recordTable.searchForm.start_time = '2026-03-21 10:00:00';
        recordTable.searchForm.end_time = '2026-03-21 11:00:00';
        recordTable.pagination.current = 4;
        recordTable.pagination.pageSize = 50;

        recordTable.handleReset();

        expect(recordTable.searchForm.status).toBeUndefined();
        expect(recordTable.searchForm.user_ids).toBeUndefined();
        expect(recordTable.searchForm.model_ids).toBeUndefined();
        expect(recordTable.searchForm.keyword).toBeUndefined();
        expect(recordTable.searchForm.start_time).toBeUndefined();
        expect(recordTable.searchForm.end_time).toBeUndefined();
        expect(recordTable.pagination.current).toBe(1);
        expect(recordTable.pagination.pageSize).toBe(10);
        expect(recordTable.dateRange.value).toBeNull();
        expect(clearRecords).not.toHaveBeenCalled();
        expect(fetchRecords).toHaveBeenCalledWith({
            page: 1,
            pageSize: 10,
            status: undefined,
            user_ids: undefined,
            model_ids: undefined,
            keyword: undefined,
            start_time: undefined,
            end_time: undefined,
        }, undefined);
        const restored = useRecordTable();
        expect(Object.values(restored.searchForm).every(value => value === undefined)).toBe(true);
        expect(restored.dateRange.value).toBeNull();
        expect(restored.pagination.current).toBe(1);
        expect(restored.pagination.pageSize).toBe(10);
    });
});
