<template>
    <div class="json-viewer-container" :class="{ expanded: expanded }">
        <!-- 工具栏 -->
        <div class="json-viewer-toolbar">
            <div class="toolbar-left">
                <span class="view-mode-title">{{ isParsedValid ? 'JSON 视图' : '原始文本' }}</span>
                <span v-if="dataSummary" class="data-summary">{{ dataSummary }}</span>
            </div>
            <div class="toolbar-right">
                <template v-if="isParsedValid">
                    <a-button
                        type="text"
                        size="small"
                        class="toolbar-btn"
                        @click="expandAll"
                    >
                        全部展开
                    </a-button>
                    <a-button
                        type="text"
                        size="small"
                        class="toolbar-btn"
                        @click="collapseAll"
                    >
                        全部折叠
                    </a-button>
                    <span class="toolbar-divider"></span>
                </template>
                <a-button
                    type="text"
                    size="small"
                    class="toolbar-btn"
                    :class="{ active: viewMode === 'tree' }"
                    :disabled="!isParsedValid"
                    @click="viewMode = 'tree'"
                >
                    树形
                </a-button>
                <a-button
                    type="text"
                    size="small"
                    class="toolbar-btn"
                    :class="{ active: viewMode === 'raw' }"
                    @click="viewMode = 'raw'"
                >
                    代码
                </a-button>
                <span class="toolbar-divider"></span>
                <a-button
                    type="text"
                    size="small"
                    class="toolbar-btn"
                    @click="handleCopy"
                >
                    复制
                </a-button>
            </div>
        </div>

        <!-- 内容区域 -->
        <div class="json-viewer-body" :class="{ 'raw-mode': viewMode === 'raw' }">
            <div v-if="!hasData" class="empty">无数据</div>
            <template v-else>
                <!-- 树形结构查看器 -->
                <div v-if="viewMode === 'tree' && isParsedValid" class="tree-wrapper">
                    <JsonTreeNode
                        :data="parsedData"
                        :depth="0"
                        :expand-depth="currentExpandDepth"
                        :is-last="true"
                    />
                </div>
                <!-- 格式化代码/原始文本视图 -->
                <div v-else class="raw-code-wrapper">
                    <div class="code-line-numbers">
                        <span v-for="line in lineCount" :key="line" class="line-num">{{ line }}</span>
                    </div>
                    <pre class="raw-pre">{{ formattedRawText }}</pre>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue/es';
import JsonTreeNode from './JsonTreeNode.vue';

interface Props {
    data: unknown;
    expanded?: boolean;
    defaultExpandDepth?: number;
}

const props = withDefaults(defineProps<Props>(), {
    expanded: true,
    defaultExpandDepth: 3
});

const viewMode = ref<'tree' | 'raw'>('tree');
const currentExpandDepth = ref(props.defaultExpandDepth);

const hasData = computed(() => props.data !== null && props.data !== undefined && props.data !== '');

const parsedResult = computed(() => {
    if (!hasData.value) return { valid: false, value: null };
    try {
        if (typeof props.data === 'string') {
            const parsed = JSON.parse(props.data);
            return { valid: true, value: parsed };
        }
        if (typeof props.data === 'object') {
            return { valid: true, value: props.data };
        }
        return { valid: false, value: props.data };
    } catch {
        return { valid: false, value: props.data };
    }
});

const isParsedValid = computed(() => parsedResult.value.valid);
const parsedData = computed(() => parsedResult.value.value);

const dataSummary = computed(() => {
    if (!isParsedValid.value || parsedData.value === null || parsedData.value === undefined) return '';
    if (Array.isArray(parsedData.value)) {
        return `Array (${parsedData.value.length} items)`;
    }
    if (typeof parsedData.value === 'object') {
        const keys = Object.keys(parsedData.value as object);
        return `Object (${keys.length} keys)`;
    }
    return '';
});

const formattedRawText = computed(() => {
    if (!hasData.value) return '';
    if (isParsedValid.value) {
        return JSON.stringify(parsedData.value, null, 2);
    }
    return String(props.data);
});

const lineCount = computed(() => {
    if (!formattedRawText.value) return 0;
    return formattedRawText.value.split('\n').length;
});

function expandAll() {
    currentExpandDepth.value = 999;
}

function collapseAll() {
    currentExpandDepth.value = 0;
}

async function handleCopy() {
    if (!hasData.value) return;
    try {
        await navigator.clipboard.writeText(formattedRawText.value);
        message.success('已复制到剪贴板');
    } catch {
        message.error('复制失败');
    }
}

defineExpose({
    handleCopy,
    expandAll,
    collapseAll
});
</script>

<style scoped>
.json-viewer-container {
    background: var(--bg-code, #f6f8fa);
    border: 1px solid var(--border-color, #e8edf5);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

/* 浅色/深色主题 CSS 变量定义 */
:global(.app-container.light) .json-viewer-container {
    --json-key-color: #881391;
    --json-string-color: #1a7f37;
    --json-number-color: #005cc5;
    --json-boolean-color: #d73a49;
    --json-null-color: #6f42c1;
    --json-bracket-color: #0451a5;
    --json-hover-bg: rgba(0, 0, 0, 0.04);
    --json-indent-guide: rgba(0, 0, 0, 0.08);
    --json-tag-bg: rgba(0, 0, 0, 0.06);
    --json-toolbar-bg: #f0f3f6;
    --json-toolbar-border: #e1e4e8;
    --json-line-num-color: #959da5;
}

:global(.app-container.dark) .json-viewer-container {
    --json-key-color: #7ee787;
    --json-string-color: #a5d6ff;
    --json-number-color: #79c0ff;
    --json-boolean-color: #ff7b72;
    --json-null-color: #d2a8ff;
    --json-bracket-color: #e3b341;
    --json-hover-bg: rgba(255, 255, 255, 0.06);
    --json-indent-guide: rgba(255, 255, 255, 0.12);
    --json-tag-bg: rgba(255, 255, 255, 0.1);
    --json-toolbar-bg: #1c2128;
    --json-toolbar-border: #30363d;
    --json-line-num-color: #484f58;
}

/* 工具栏样式 */
.json-viewer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--json-toolbar-bg, #f0f3f6);
    border-bottom: 1px solid var(--json-toolbar-border, #e1e4e8);
    user-select: none;
    font-size: 12px;
}

.toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

.view-mode-title {
    font-weight: 600;
    color: var(--text-primary, #243247);
}

.data-summary {
    color: var(--text-secondary, #8c8c8c);
    font-size: 11px;
}

.toolbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
}

.toolbar-btn {
    font-size: 12px;
    height: 24px;
    padding: 0 8px;
    color: var(--text-secondary, #666);
    border-radius: 4px;
}

.toolbar-btn:hover {
    color: var(--accent-primary, #258fff);
    background: var(--json-hover-bg, rgba(0, 0, 0, 0.04));
}

.toolbar-btn.active {
    color: var(--accent-primary, #258fff);
    font-weight: 600;
    background: var(--json-hover-bg, rgba(0, 0, 0, 0.06));
}

.toolbar-divider {
    width: 1px;
    height: 12px;
    background: var(--json-toolbar-border, #e1e4e8);
    margin: 0 4px;
}

/* 内容主体 */
.json-viewer-body {
    max-height: 400px;
    overflow: auto;
    transition: max-height 0.3s ease;
    padding: 12px 14px;
}

.json-viewer-container.expanded .json-viewer-body {
    max-height: 700px;
}

.tree-wrapper {
    min-width: 100%;
}

.raw-code-wrapper {
    display: flex;
    gap: 12px;
    font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, Menlo, Monaco, monospace;
    font-size: 12px;
    line-height: 20px;
}

.code-line-numbers {
    display: flex;
    flex-direction: column;
    text-align: right;
    user-select: none;
    color: var(--json-line-num-color, #959da5);
    padding-right: 8px;
    border-right: 1px solid var(--json-indent-guide, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
}

.line-num {
    height: 20px;
    line-height: 20px;
}

.raw-pre {
    margin: 0;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    flex: 1;
}

.empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
}
</style>
