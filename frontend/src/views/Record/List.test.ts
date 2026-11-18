import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { listRecords } from '@/api/record';
import { useAppStore } from '@/stores/app';
import { useRecordStore } from '@/stores/record';
import recordTableState from '@/stores/recordTable';
import { RunMode } from '@/types/system';
import type { Record, RecordListResponse } from '@/types/record';
import List from './List.vue';

vi.mock('@/api/record', () => ({ listRecords: vi.fn() }));
const directory = vi.hoisted(() => ({ loadUsers: vi.fn(), loadModels: vi.fn(), loadVendors: vi.fn() }));
vi.mock('@/stores/directory', () => ({ useDirectoryStore: () => directory }));

const tableStub = defineComponent({
    name: 'RecordTable',
    props: ['records', 'loading', 'pagination'],
    setup(props) {
        return () => h('div', { 'data-testid': 'record-table', 'aria-busy': String(props.loading) },
            props.records.length ? `record ${props.records[0].id}` : 'No data');
    },
});
const alertStub = defineComponent({
    props: ['message', 'description'],
    setup(props, { slots }) {
        return () => h('div', { role: 'alert' }, [props.message, props.description, slots.action?.()]);
    },
});

function deferred() {
    let resolve!: (value: RecordListResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<RecordListResponse>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function response(): RecordListResponse {
    return { list: [{ id: 1, status: 'success', user_id: -1, model_id: null } as Record], total: 50 };
}

describe('record list feedback', () => {
    let pinia: ReturnType<typeof createPinia>;
    let wrapper: VueWrapper;

    function mountList() {
        wrapper = mount(List, { global: {
            plugins: [pinia],
            stubs: { RecordTable: tableStub, RecordReplyPreview: true, AAlert: alertStub },
        } });
        return wrapper;
    }

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
        useAppStore().mode = RunMode.WORKER;
    });

    afterEach(() => {
        wrapper?.unmount();
        disposePinia(pinia);
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows immediate loading and retains old records with a persistent warning after search failure', async () => {
        const state = recordTableState.useRecordTableStore();
        state.pagination.current = 3;
        state.pagination.pageSize = 20;
        vi.mocked(listRecords).mockResolvedValueOnce(response());
        mountList();
        await flushPromises();
        Object.values(directory).forEach(mock => mock.mockClear());
        const pending = deferred();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        state.searchForm.keyword = 'new';
        await wrapper.findAll('button').find(button => button.text().replace(/\s/g, '') === '搜索')!.trigger('click');
        expect(wrapper.get('[data-testid="record-table"]').attributes('aria-busy')).toBe('true');
        expect(wrapper.text()).toContain('record 1');
        expect(wrapper.text()).not.toContain('No data');
        pending.reject(new Error('503'));
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toContain('上次成功');
        expect(wrapper.get('[role="alert"]').text()).toContain('第 3 页');
        expect(wrapper.findComponent(tableStub).props('pagination')).toMatchObject({ current: 3, pageSize: 20, total: 50 });
        expect(wrapper.get('[data-testid="record-table"]').attributes('aria-busy')).toBe('false');
        Object.values(directory).forEach(mock => expect(mock).not.toHaveBeenCalled());

        const retry = deferred();
        vi.mocked(listRecords).mockReturnValueOnce(retry.promise);
        await wrapper.findAll('button').find(button => button.text().replace(/\s/g, '') === '重试')!.trigger('click');
        expect(wrapper.find('[role="alert"]').exists()).toBe(true);
        retry.resolve({ list: [], total: 0 });
        await flushPromises();
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('No data');
    });

    it('shows initial failure instead of an empty result and recovers through retry', async () => {
        vi.mocked(listRecords).mockRejectedValueOnce(new Error('503'));
        mountList();
        await flushPromises();
        expect(wrapper.get('[role="alert"]').text()).toContain('记录列表加载失败');
        expect(wrapper.find('[data-testid="record-table"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('No data');
        vi.mocked(listRecords).mockResolvedValueOnce(response());
        await wrapper.findAll('button').find(button => button.text().replace(/\s/g, '') === '重试')!.trigger('click');
        await flushPromises();
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('record 1');
    });

    it('avoids duplicate mount requests and keeps short node background refreshes silent', async () => {
        useAppStore().mode = RunMode.NODE;
        const initial = deferred();
        vi.mocked(listRecords).mockReturnValueOnce(initial.promise);
        mountList();
        await flushPromises();
        expect(listRecords).toHaveBeenCalledTimes(1);
        initial.resolve(response());
        await flushPromises();
        const pending = deferred();
        vi.mocked(listRecords).mockReturnValueOnce(pending.promise);
        await vi.advanceTimersByTimeAsync(5000);
        expect(listRecords).toHaveBeenCalledTimes(2);
        expect(useRecordStore().listLoading).toBe(false);
        await vi.advanceTimersByTimeAsync(2999);
        expect(useRecordStore().listLoading).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(useRecordStore().listLoading).toBe(true);
        pending.resolve(response());
        await flushPromises();
        expect(useRecordStore().listLoading).toBe(false);
    });
});
