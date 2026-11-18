import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import type { Dayjs } from 'dayjs';
import { useRecordStore, type RecordListFetchOptions } from '@/stores/record';
import recordTableState from '@/stores/recordTable';
import type { RecordQuery, RequestStatus } from '@/types/record';

export interface RecordSearchForm {
    status?: RequestStatus;
    user_ids?: number[];
    model_ids?: number[];
    start_time?: string;
    end_time?: string;
    keyword?: string;
}

export function useRecordTable() {
    const recordStore = useRecordStore();
    const recordTableStore = recordTableState.useRecordTableStore();
    const { searchForm, pagination } = recordTableStore;
    const { dateRange } = storeToRefs(recordTableStore);
    // 保留旧结果时，分页也展示该次成功查询，不能用新页码标记旧数据。
    const displayPagination = computed(() => {
        const query = recordStore.lastSuccessfulQuery;
        return query ? {
            ...pagination,
            current: query.page ?? 1,
            pageSize: query.pageSize ?? 10,
            total: recordStore.total,
        } : pagination;
    });

    function buildQuery(): RecordQuery {
        return {
            page: pagination.current,
            pageSize: pagination.pageSize,
            ...searchForm,
            user_ids: searchForm.user_ids?.length ? searchForm.user_ids.join(",") : undefined,
            model_ids: searchForm.model_ids?.length ? searchForm.model_ids.join(",") : undefined,
        };
    }

    async function loadData(options?: RecordListFetchOptions): Promise<void> {
        const result = await recordStore.fetchRecords(buildQuery(), options);
        if (result.status === 'success') {
            pagination.total = result.total;
        }
    }

    function handleSearch(): void {
        pagination.current = 1;
        void loadData();
    }

    function handleReset(): void {
        const total = pagination.total;
        recordTableStore.reset();
        pagination.total = total;
        void loadData();
    }

    function handleTableChange(pag: TablePaginationConfig): void {
        pagination.current = pag.current ?? 1;
        pagination.pageSize = pag.pageSize ?? pagination.pageSize;
        void loadData();
    }

    function handleDateChange(dates: [Dayjs, Dayjs] | null): void {
        if (dates) {
            searchForm.start_time = dates[0].format('YYYY-MM-DD HH:mm:ss');
            searchForm.end_time = dates[1].format('YYYY-MM-DD HH:mm:ss');
            return;
        }

        searchForm.start_time = undefined;
        searchForm.end_time = undefined;
    }

    return {
        recordStore,
        searchForm,
        pagination,
        displayPagination,
        dateRange,
        loadData,
        handleSearch,
        handleReset,
        handleTableChange,
        handleDateChange,
    };
}
