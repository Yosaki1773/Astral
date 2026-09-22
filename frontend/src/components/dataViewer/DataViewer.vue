<template>
    <div class="data-viewer-root" :class="{ 'data-viewer-embedded': embedded }">
        <LlmChat v-if="type === 'llm'" :data="data" />
        <MarkdownViewer v-else-if="type === 'markdown'" :data="data" />
        <Empty v-else />
    </div>
</template>

<script>
import LlmChat from './LlmChat.vue';
import MarkdownViewer from './MarkdownViewer.vue';
import Empty from './Empty.vue';
import './viewer-theme.css';

/**
 * 对话/内容可视化组件
 *
 * 由原独立 data_viewer 子项目的 App.vue + main.js 迁移而来：
 * - 原来的 window.gt_bridge 全局桥接改为 props，宿主直接传数据
 * - 原来的 data-theme 属性切换主题改为跟随宿主前端的 html.dark
 */
export default {
    name: 'DataViewer',
    components: {
        LlmChat,
        MarkdownViewer,
        Empty
    },
    props: {
        // 待可视化数据：LLM 对话（数组或 { system, messages }）或 Markdown 文本/对象
        data: {
            type: [Array, Object, String],
            default: null
        },
        // 显式指定渲染类型，留空则自动识别
        dataType: {
            type: String,
            default: null,
            validator: (value) => [null, '', 'llm', 'markdown'].includes(value)
        },
        // 内嵌在页面面板中（非独立整页）
        embedded: {
            type: Boolean,
            default: false
        }
    },
    computed: {
        type() {
            if (this.dataType) {
                return this.dataType;
            }

            if (Array.isArray(this.data)) {
                return 'llm';
            }

            if (this.data && typeof this.data === 'object' && Array.isArray(this.data.messages)) {
                return 'llm';
            }

            if (typeof this.data === 'string' || (this.data && typeof this.data === 'object')) {
                return 'markdown';
            }

            return null;
        }
    }
};
</script>

<style scoped>
.data-viewer-root {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    color: var(--dv-text);
    background: var(--dv-body-bg);
}

.data-viewer-root.data-viewer-embedded {
    display: flex;
    flex-direction: column;
}
</style>
