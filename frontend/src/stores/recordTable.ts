import { defineStore } from 'pinia';
import { reactive, ref, watch } from 'vue';
import type { Dayjs } from 'dayjs';
import type { TablePaginationState } from '@/types';
import type { RecordSearchForm } from '@/composables/useRecordTable';
import { useAuthStore } from './auth';
import { useTenantStore } from './tenant';

const DEFAULT_PAGE_SIZE = 10;

// 列表组件会在查看详情时销毁；表单和分页保存在会话内，返回时继续使用。
const useRecordTableStore = defineStore('recordTable', () => {
    const authStore = useAuthStore();
    const tenantStore = useTenantStore();
    const dateRange = ref<[Dayjs, Dayjs] | null>(null);
    const searchForm = reactive<RecordSearchForm>({
        status: undefined,
        user_ids: undefined,
        model_ids: undefined,
        start_time: undefined,
        end_time: undefined,
        keyword: undefined,
    });
    const pagination = reactive<TablePaginationState>({
        current: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        total: 0,
        showSizeChanger: true,
        showQuickJumper: true,
        pageSizeOptions: ['10', '20', '50', '100'],
    });

    function reset(): void {
        searchForm.status = undefined;
        searchForm.user_ids = undefined;
        searchForm.model_ids = undefined;
        searchForm.start_time = undefined;
        searchForm.end_time = undefined;
        searchForm.keyword = undefined;
        dateRange.value = null;
        pagination.current = 1;
        pagination.pageSize = DEFAULT_PAGE_SIZE;
        pagination.total = 0;
    }

    // 账号或租户变化时立即清空，不能把旧租户的用户/模型筛选带入新视角。
    watch(
        [() => authStore.token, () => tenantStore.currentTenantId],
        reset,
        { flush: 'sync' },
    );

    return {
        searchForm,
        pagination,
        dateRange,
        reset,
    };
});


export default {
    useRecordTableStore,
};
