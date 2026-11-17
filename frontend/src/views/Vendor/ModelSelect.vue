<template>
    <a-form-item label="模型配置">
        <div class="model-toolbar">
            <a-button :loading="loading" :disabled="disabled || !connection.token.trim()" @click="handleFetch">
                获取模型列表
            </a-button>
            <span class="model-hint">使用当前 URL 和认证信息，无需先保存</span>
        </div>
        <template v-if="candidates.length > 0">
            <div class="select-actions">
                <a-button type="link" size="small" :disabled="disabled" @click="selectModels(candidates)">全选</a-button>
                <a-button type="link" size="small" :disabled="disabled" @click="selectModels([])">全不选</a-button>
                <span class="model-hint">已选 {{ selected.length }} / {{ candidates.length }}</span>
            </div>
            <a-input v-model:value="search" placeholder="搜索模型名称" allow-clear />
            <div class="model-options">
                <a-checkbox
                    v-for="id in filteredModels"
                    :key="id"
                    :checked="selected.includes(id)"
                    :disabled="disabled"
                    class="model-option"
                    @change="toggleModel(id, $event.target.checked)"
                >{{ id }}</a-checkbox>
                <div v-if="filteredModels.length === 0" class="empty-hint">无匹配结果</div>
            </div>
        </template>
        <div v-else class="empty-hint">{{ fetched ? '未获取到模型列表' : '获取后选择模型，保存时一并保存' }}</div>
        <div v-if="errorMessage" class="model-error" role="alert">{{ errorMessage }}</div>
    </a-form-item>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { fetchDraftVendorModels } from '@/api/vendor';
import type { VendorConnectionRequest } from '@/types/vendor';

const props = withDefaults(defineProps<{
    connection: VendorConnectionRequest;
    initialModelIds?: string[];
    modelValue?: string[];
    disabled?: boolean;
}>(), { initialModelIds: () => [], disabled: false });
const emit = defineEmits<{
    'update:modelValue': [ids: string[]];
    loading: [value: boolean];
}>();

const loading = ref(false);
const fetched = ref(false);
const fetchedModels = ref<string[]>([]);
const search = ref('');
const errorMessage = ref('');
let requestId = 0;

const selected = computed(() => props.modelValue ?? props.initialModelIds);
const candidates = computed(() => [...new Set([...props.initialModelIds, ...fetchedModels.value, ...selected.value])]);
const filteredModels = computed(() => candidates.value.filter(id => id.toLowerCase().includes(search.value.toLowerCase())));

function invalidateRequest() {
    requestId++;
    loading.value = false;
    emit('loading', false);
}

watch(() => props.connection, invalidateRequest, { deep: true });
onBeforeUnmount(invalidateRequest);

async function handleFetch() {
    const id = ++requestId;
    loading.value = true;
    emit('loading', true);
    errorMessage.value = '';
    try {
        const result = await fetchDraftVendorModels(props.connection);
        if (id !== requestId) return;
        fetchedModels.value = result.models;
        fetched.value = true;
        search.value = '';
    } catch (error) {
        if (id !== requestId) return;
        errorMessage.value = error instanceof Error ? error.message : '获取模型列表失败，请检查 URL 和认证信息';
    } finally {
        if (id === requestId) {
            loading.value = false;
            emit('loading', false);
        }
    }
}

function selectModels(ids: string[]) {
    emit('update:modelValue', [...ids]);
}

function toggleModel(id: string, checked: boolean) {
    selectModels(checked ? [...selected.value, id] : selected.value.filter(value => value !== id));
}
</script>

<style scoped>
.model-toolbar, .select-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
}

.model-hint, .empty-hint {
    color: var(--text-secondary);
    font-size: 13px;
}

.model-options {
    max-height: 220px;
    overflow-y: auto;
    margin-top: 8px;
}

.model-option {
    display: flex;
    margin-inline-start: 0;
    padding: 6px 0;
    overflow-wrap: anywhere;
}

.empty-hint {
    padding: 8px 0;
}

.model-error {
    color: var(--error-color, #ff4d4f);
    margin-top: 8px;
}
</style>
