<template>
    <div class="rendered-markdown" v-html="recordReply.renderMarkdown(content)"></div>
</template>

<script setup lang="ts">
import recordReply from '@/utils/recordReply';

defineProps<{ content: string }>();
</script>

<style scoped>
.rendered-markdown {
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--text-primary);
    overflow-wrap: anywhere;
}

.rendered-markdown :deep(h1),
.rendered-markdown :deep(h2),
.rendered-markdown :deep(h3),
.rendered-markdown :deep(h4) {
    color: var(--text-primary);
    font-weight: 700;
    margin-top: 12px;
    margin-bottom: 6px;
}

.rendered-markdown :deep(h1) { font-size: 15px; }
.rendered-markdown :deep(h2) { font-size: 14px; }
.rendered-markdown :deep(h3) { font-size: 13px; }
.rendered-markdown :deep(h4) { font-size: 12.5px; }

.rendered-markdown :deep(p) {
    margin-top: 0;
    margin-bottom: 8px;
}

.rendered-markdown :deep(ul),
.rendered-markdown :deep(ol) {
    margin-top: 0;
    margin-bottom: 8px;
    padding-left: 20px;
}

.rendered-markdown :deep(li) { margin-bottom: 4px; }

.rendered-markdown :deep(code) {
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 11.5px;
    background-color: var(--bg-info-item);
    color: var(--text-primary);
    padding: 2px 5px;
    border-radius: 4px;
}

.rendered-markdown :deep(pre) {
    background-color: var(--bg-code-header);
    padding: 12px 14px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 10px 0;
}

.rendered-markdown :deep(pre code) {
    background-color: transparent;
    color: var(--text-primary);
    padding: 0;
    font-size: 11px;
    line-height: 1.5;
}

.rendered-markdown :deep(blockquote) {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid var(--border-color);
    color: var(--text-secondary);
}

.rendered-markdown :deep(table) {
    border-collapse: collapse;
    margin-bottom: 8px;
}

.rendered-markdown :deep(th),
.rendered-markdown :deep(td) {
    border: 1px solid var(--border-color);
    padding: 4px 8px;
}

.rendered-markdown :deep(img) { max-width: 100%; }
</style>
