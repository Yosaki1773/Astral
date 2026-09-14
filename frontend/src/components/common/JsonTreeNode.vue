<template>
    <div class="json-tree-node" :class="{ 'is-root': depth === 0 }">
        <!-- 复杂类型（Object / Array）并且非空 -->
        <template v-if="isComplex && !isEmpty">
            <div class="node-line complex-header" @click="toggleExpand">
                <span class="toggle-btn" :class="{ collapsed: isCollapsed }">
                    <svg viewBox="0 0 1024 1024" width="10" height="10" fill="currentColor">
                        <path d="M715.6 476.1L355.7 116.2c-17.7-17.7-46.3-17.7-64 0-17.7 17.7-17.7 46.3 0 64L619.6 508 291.7 835.9c-17.7 17.7-17.7 46.3 0 64 17.7 17.7 46.3 17.7 64 0l359.9-359.9c17.7-17.7 17.7-46.3 0-63.9z" />
                    </svg>
                </span>

                <span v-if="nodeKey !== undefined" class="json-key" :title="String(nodeKey)">"{{ nodeKey }}"</span>
                <span v-if="nodeKey !== undefined" class="json-colon">: </span>

                <span class="json-bracket">{{ openBracket }}</span>

                <!-- 折叠时预览摘要 -->
                <span v-if="isCollapsed" class="collapsed-preview">
                    <span class="collapsed-ellipsis">...</span>
                    <span class="json-bracket">{{ closeBracket }}</span>
                    <span class="item-count">{{ itemCountText }}</span>
                    <span v-if="!isLast" class="json-comma">,</span>
                </span>
            </div>

            <!-- 展开的子节点列表 -->
            <div v-if="!isCollapsed" class="node-children">
                <JsonTreeNode
                    v-for="(child, index) in children"
                    :key="child.key"
                    :data="child.value"
                    :node-key="isArray ? undefined : child.key"
                    :depth="depth + 1"
                    :expand-depth="expandDepth"
                    :is-last="index === children.length - 1"
                />
            </div>

            <div v-if="!isCollapsed" class="node-line complex-footer">
                <span class="toggle-placeholder"></span>
                <span class="json-bracket">{{ closeBracket }}</span>
                <span v-if="!isLast" class="json-comma">,</span>
            </div>
        </template>

        <!-- 空 Object / 空 Array -->
        <template v-else-if="isComplex && isEmpty">
            <div class="node-line leaf-line">
                <span class="toggle-placeholder"></span>
                <span v-if="nodeKey !== undefined" class="json-key">"{{ nodeKey }}"</span>
                <span v-if="nodeKey !== undefined" class="json-colon">: </span>
                <span class="json-bracket">{{ openBracket }}{{ closeBracket }}</span>
                <span v-if="!isLast" class="json-comma">,</span>
            </div>
        </template>

        <!-- 基本数据类型（string, number, boolean, null） -->
        <template v-else>
            <div class="node-line leaf-line">
                <span class="toggle-placeholder"></span>
                <span v-if="nodeKey !== undefined" class="json-key">"{{ nodeKey }}"</span>
                <span v-if="nodeKey !== undefined" class="json-colon">: </span>
                <span :class="valueClass">{{ formattedValue }}</span>
                <span v-if="!isLast" class="json-comma">,</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

defineOptions({
    name: 'JsonTreeNode'
});

interface Props {
    data: unknown;
    nodeKey?: string | number;
    depth?: number;
    expandDepth?: number;
    isLast?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
    nodeKey: undefined,
    depth: 0,
    expandDepth: 2,
    isLast: true
});

const isArray = computed(() => Array.isArray(props.data));
const isObject = computed(() => props.data !== null && typeof props.data === 'object' && !isArray.value);
const isComplex = computed(() => isArray.value || isObject.value);

const children = computed<{ key: string | number; value: unknown }[]>(() => {
    if (!isComplex.value || props.data === null || props.data === undefined) return [];
    if (isArray.value) {
        return (props.data as unknown[]).map((val, idx) => ({ key: idx, value: val }));
    }
    return Object.entries(props.data as Record<string, unknown>).map(([k, val]) => ({ key: k, value: val }));
});

const isEmpty = computed(() => children.value.length === 0);

const openBracket = computed(() => (isArray.value ? '[' : '{'));
const closeBracket = computed(() => (isArray.value ? ']' : '}'));

const itemCountText = computed(() => {
    const len = children.value.length;
    return isArray.value ? `${len} items` : `${len} keys`;
});

// 折叠状态控制
const isCollapsed = ref(props.depth >= props.expandDepth);

watch(
    () => props.expandDepth,
    (newDepth) => {
        isCollapsed.value = props.depth >= newDepth;
    }
);

function toggleExpand() {
    isCollapsed.value = !isCollapsed.value;
}

const valueClass = computed(() => {
    if (props.data === null) return 'json-null';
    const t = typeof props.data;
    if (t === 'string') return 'json-string';
    if (t === 'number') return 'json-number';
    if (t === 'boolean') return 'json-boolean';
    return 'json-other';
});

const formattedValue = computed(() => {
    if (props.data === null) return 'null';
    if (props.data === undefined) return 'undefined';
    if (typeof props.data === 'string') {
        return JSON.stringify(props.data);
    }
    return String(props.data);
});
</script>

<style scoped>
.json-tree-node {
    font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, Menlo, Monaco, monospace;
    font-size: 12px;
    line-height: 20px;
    user-select: text;
}

.node-line {
    display: flex;
    align-items: center;
    min-height: 20px;
    padding: 1px 4px;
    border-radius: 3px;
    transition: background-color 0.15s ease;
}

.complex-header {
    cursor: pointer;
}

.complex-header:hover {
    background-color: var(--json-hover-bg, rgba(0, 0, 0, 0.04));
}

.toggle-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-right: 4px;
    color: var(--text-secondary, #8c8c8c);
    transform: rotate(90deg);
    transition: transform 0.2s ease, color 0.2s ease;
    flex-shrink: 0;
}

.toggle-btn.collapsed {
    transform: rotate(0deg);
}

.toggle-btn:hover {
    color: var(--accent-primary, #258fff);
}

.toggle-placeholder {
    width: 16px;
    height: 16px;
    margin-right: 4px;
    flex-shrink: 0;
}

.node-children {
    padding-left: 18px;
    border-left: 1px dashed var(--json-indent-guide, rgba(0, 0, 0, 0.1));
    margin-left: 7px;
}

/* Key, brackets, punctuation */
.json-key {
    color: var(--json-key-color, #881391);
    font-weight: 500;
}

.json-colon {
    color: var(--text-primary, #333333);
    margin-right: 4px;
}

.json-bracket {
    color: var(--json-bracket-color, #0451a5);
    font-weight: 600;
}

.json-comma {
    color: var(--text-secondary, #8c8c8c);
}

/* Value styling */
.json-string {
    color: var(--json-string-color, #1a7f37);
    word-break: break-all;
    white-space: pre-wrap;
}

.json-number {
    color: var(--json-number-color, #005cc5);
    font-weight: 500;
}

.json-boolean {
    color: var(--json-boolean-color, #d73a49);
    font-weight: 600;
}

.json-null {
    color: var(--json-null-color, #6f42c1);
    font-weight: 600;
}

.json-other {
    color: var(--text-secondary, #666666);
}

/* Collapsed preview */
.collapsed-preview {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}

.collapsed-ellipsis {
    color: var(--text-secondary, #8c8c8c);
    padding: 0 4px;
    background: var(--json-tag-bg, rgba(0, 0, 0, 0.05));
    border-radius: 3px;
    margin: 0 2px;
    font-size: 11px;
    line-height: 14px;
}

.item-count {
    color: var(--text-secondary, #999999);
    font-size: 11px;
    margin-left: 6px;
    font-style: italic;
}
</style>
