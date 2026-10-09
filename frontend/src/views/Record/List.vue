<template>
    <div class="record-list">
        <div class="table-header">
            <div class="search-area">
                <a-form layout="inline">
                    <a-form-item label="状态">
                        <a-select
                            v-model:value="searchForm.status"
                            placeholder="全部状态"
                            style="width: 120px"
                            allow-clear
                        >
                            <a-select-option value="success">成功</a-select-option>
                            <a-select-option value="failed">失败</a-select-option>
                            <a-select-option value="processing">处理中</a-select-option>
                            <a-select-option value="init">初始化</a-select-option>
                        </a-select>
                    </a-form-item>
                    <a-form-item label="用户">
                        <a-select
                            v-model:value="searchForm.user_ids"
                            mode="multiple"
                            placeholder="搜索用户"
                            allow-clear
                            show-search
                            :filter-option="filterOption"
                            style="min-width: 150px"
                            :options="userOptions"
                        />
                    </a-form-item>
                    <a-form-item label="模型">
                        <a-select
                            v-model:value="searchForm.model_ids"
                            mode="multiple"
                            placeholder="搜索模型"
                            allow-clear
                            show-search
                            :filter-option="filterOption"
                            style="min-width: 240px"
                            :options="modelOptions"
                        />
                    </a-form-item>
                    <a-form-item label="时间范围">
                        <a-range-picker
                            v-model:value="dateRange"
                            :show-time="{ format: 'HH:mm' }"
                            format="YYYY-MM-DD HH:mm"
                            @change="handleDateChange"
                            style="width: 340px"
                        />
                    </a-form-item>
                    <a-form-item label="关键字">
                        <a-input
                            v-model:value="searchForm.keyword"
                            placeholder="搜索请求/响应内容"
                            allow-clear
                            style="width: 240px"
                            @press-enter="handleSearch"
                        />
                    </a-form-item>
                    <a-form-item>
                        <a-space>
                            <a-button type="primary" @click="handleSearch">搜索</a-button>
                            <a-button @click="handleReset">重置</a-button>
                        </a-space>
                    </a-form-item>
                </a-form>
            </div>
            <div class="action-area">
                <a-space>
                    <a-tooltip title="自动刷新">
                        <a-switch
                            :checked="autoRefreshEnabled"
                            checked-children="开"
                            un-checked-children="关"
                            @change="handleAutoRefreshChange"
                        />
                    </a-tooltip>
                    <span class="refresh-hint">
                        自动刷新
                        <template v-if="autoRefreshEnabled">
                            ({{ remainingSeconds }} 秒后刷新)
                        </template>
                    </span>
                </a-space>
            </div>
        </div>

        <RecordTable
            :records="recordStore.records"
            :loading="recordStore.loading"
            :pagination="pagination"
            @change="handleTableChange"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useAutoRefresh } from '@/composables/useAutoRefresh';
import { useRecordTable } from '@/composables/useRecordTable';
import RecordTable from '@/components/common/RecordTable.vue';
import { useDirectoryStore } from '@/stores/directory';
import { useAppStore } from '@/stores/app';
import { RunMode } from '@/types/system';

const directoryStore = useDirectoryStore();
const appStore = useAppStore();

const userOptions = ref<{ value: number; label: string }[]>([]);
const modelOptions = ref<{ value: number; label: string }[]>([]);

function filterOption(input: string, option: { label: string }) {
    return option.label.toLowerCase().includes(input.toLowerCase());
}

async function loadSelectOptions() {
    const [users, models] = await Promise.all([
        directoryStore.loadUsers(),
        directoryStore.loadModels(),
    ]);
    userOptions.value = [
        { value: -1, label: 'root' },
        ...users.map(u => ({ value: Number(u.id), label: u.name })),
    ];
    modelOptions.value = models.map(m => ({ value: Number(m.id), label: m.name }));
}

const {
    recordStore,
    searchForm,
    pagination,
    dateRange,
    loadData,
    handleSearch,
    handleReset,
    handleTableChange,
    handleDateChange,
} = useRecordTable();

// worker 模式下 D1 写入配额紧张：默认关闭自动刷新、且把间隔改回 30 秒
// node 模式保持原有行为：默认开启、5 秒刷新一次
const isWorkerMode = computed(() => appStore.mode === RunMode.WORKER);

const {
    isRunning: autoRefreshEnabled,
    start: startAutoRefresh,
    stop: stopAutoRefresh,
    setIntervalValue,
    remainingSeconds,
} = useAutoRefresh({
    callback: () => loadData(),
    defaultInterval: 30000,
    immediate: false,
});

onMounted(async () => {
    void loadSelectOptions();
    void loadData();

    if (!appStore.mode) {
        try {
            await appStore.fetchStatus();
        } catch (error) {
            console.error('Failed to fetch app status:', error);
        }
    }

    if (isWorkerMode.value) {
        setIntervalValue(30000);
        stopAutoRefresh();
    } else {
        setIntervalValue(5000);
        void startAutoRefresh();
    }
});

onUnmounted(() => {
    stopAutoRefresh();
});

function handleAutoRefreshChange(checked: boolean) {
    if (checked) {
        void startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
}
</script>

<style scoped>
.record-list {
    background: var(--bg-page);
    padding: 24px;
}

.table-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 16px;
}

.search-area {
    flex: 1;
    min-width: 0;
}

.search-area :deep(.ant-form-item) {
    margin-bottom: 12px;
    margin-right: 16px;
}

/* 最后一个 item 不需要右边距 */
.search-area :deep(.ant-form-item:last-child) {
    margin-right: 0;
}

.action-area {
    flex-shrink: 0;
    padding-top: 4px;
}

.refresh-hint {
    font-size: 12px;
    color: var(--text-secondary);
}
</style>
