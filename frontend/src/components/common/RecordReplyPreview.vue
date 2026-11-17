<template>
    <section v-if="visible" ref="panel" class="reply-preview" aria-label="回复预览">
        <ReplyMarkdown v-if="replyText" :content="replyText" />
        <div v-else class="reply-preview-placeholder" role="status">
            <template v-if="activeRecord?.status === 'processing'">
                <span>{{ error || '等待回复生成…' }}</span>
                <span>请求耗时 {{ elapsedSeconds }} 秒</span>
            </template>
            <span v-else-if="loading">正在加载回复…</span>
            <span v-else-if="error">{{ error }}</span>
            <span v-else>{{ activeRecord?.response_data ? '暂无可预览的回复文本' : '响应内容未记录' }}</span>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { getRecord } from '@/api/record';
import type { Record } from '@/types/record';
import recordReply from '@/utils/recordReply';
import ReplyMarkdown from './ReplyMarkdown.vue';

const props = defineProps<{ record: Record | null }>();
const activeRecord = ref<Record | null>(null);
const replyText = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
const now = ref(Date.now());
const panel = ref<HTMLElement | null>(null);
let generation = 0;
let pollTimer: number | undefined;
let clockTimer: number | undefined;

const visible = computed(() => activeRecord.value?.status === 'success' || activeRecord.value?.status === 'processing');
const elapsedSeconds = computed(() => {
    const record = activeRecord.value;
    if (!record) return '0.0';
    const start = new Date(record.start_at ?? String(record.created_at)).getTime();
    return Number.isFinite(start) ? (Math.max(0, now.value - start) / 1000).toFixed(1) : '0.0';
});

function stopTimers(): void {
    window.clearTimeout(pollTimer);
    window.clearInterval(clockTimer);
    pollTimer = undefined;
    clockTimer = undefined;
}

async function loadReply(id: number, currentGeneration: number): Promise<void> {
    try {
        const record = await getRecord(id);
        if (currentGeneration !== generation) return;
        activeRecord.value = record;
        replyText.value = recordReply.getReplyText(record.response_data);
        error.value = '';
    } catch (e) {
        if (currentGeneration !== generation) return;
        if ((e as { status?: number }).status === 404) activeRecord.value = null;
        error.value = '回复加载失败';
    } finally {
        if (currentGeneration === generation) {
            loading.value = false;
            if (activeRecord.value?.status === 'processing') {
                pollTimer = window.setTimeout(() => { void loadReply(id, currentGeneration); }, 1000);
            } else {
                stopTimers();
            }
        }
    }
}

watch([() => props.record?.id, () => props.record?.status], ([id, status], previous) => {
    const currentGeneration = ++generation;
    stopTimers();
    error.value = '';
    loading.value = false;
    if (id !== previous?.[0]) {
        replyText.value = null;
        void nextTick(() => { panel.value?.scrollTo({ top: 0 }); });
    }
    if (id === undefined || (status !== 'success' && status !== 'processing')) {
        activeRecord.value = null;
        replyText.value = null;
        return;
    }
    activeRecord.value = { ...props.record! };
    now.value = Date.now();
    loading.value = true;
    if (status === 'processing') {
        clockTimer = window.setInterval(() => { now.value = Date.now(); }, 250);
    }
    void loadReply(id, currentGeneration);
}, { immediate: true });

onUnmounted(() => {
    ++generation;
    stopTimers();
});
</script>

<style scoped>
.reply-preview {
    height: 200px;
    box-sizing: border-box;
    overflow: auto;
    margin-top: 16px;
    padding: 16px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-page);
}

.reply-preview-placeholder {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--text-secondary);
}
</style>
