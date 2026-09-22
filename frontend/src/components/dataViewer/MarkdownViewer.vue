<template>
  <div class="markdown-viewer">
    <div class="markdown-content" v-html="renderedMarkdown"></div>
  </div>
</template>

<script>
import { marked } from 'marked';

export default {
  name: 'MarkdownViewer',
  props: {
    // Markdown 数据（替代原独立项目的全局 store）
    data: {
      type: [String, Object, Array],
      default: null
    }
  },
  computed: {
    renderedMarkdown() {
      if (!this.data) {
        return '';
      }
      
      // 如果 data 是字符串，直接渲染
      if (typeof this.data === 'string') {
        const content = this.data.replace(/<(?!\/?(?:h1|h2|h3|h4|h5|h6|p|div|span|br|hr|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|pre|code|strong|b|em|i|a|img)\b)([^>]+)>/g, '\n$&\n');
        return marked(content);
      }
      
      // 如果 data 是对象或数组，转换为 markdown
      if (typeof this.data === 'object') {
        const markdown = JSON.stringify(this.data, null, 2);
        return marked('```json\n' + markdown + '\n```');
      }
      
      return '';
    }
  }
};
</script>

<style scoped>
.markdown-viewer {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  background-color: var(--dv-preview-body-bg);
  color: var(--dv-markdown-text);
}

.markdown-content {
  max-width: 1200px;
  margin: 0 auto;
  text-align: left;
}

/* Markdown 样式 */
.markdown-content :deep(h1) {
  font-size: 2em;
  font-weight: bold;
  margin-top: 0.67em;
  margin-bottom: 0.67em;
  border-bottom: 2px solid var(--dv-markdown-heading-border);
  padding-bottom: 0.3em;
  color: var(--dv-markdown-heading);
}

.markdown-content :deep(h2) {
  font-size: 1.5em;
  font-weight: bold;
  margin-top: 0.83em;
  margin-bottom: 0.83em;
  border-bottom: 1px solid var(--dv-markdown-heading-border);
  padding-bottom: 0.3em;
  color: var(--dv-markdown-heading);
}

.markdown-content :deep(h3) {
  font-size: 1.25em;
  font-weight: bold;
  margin-top: 1em;
  margin-bottom: 1em;
  color: var(--dv-markdown-heading);
}

.markdown-content :deep(p) {
  margin-top: 0;
  margin-bottom: 16px;
  line-height: 1.6;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 2em;
  margin-bottom: 16px;
}

.markdown-content :deep(li) {
  margin-bottom: 0.25em;
}

.markdown-content :deep(blockquote) {
  padding: 0 1em;
  color: var(--dv-markdown-blockquote-text);
  border-left: 0.25em solid var(--dv-markdown-blockquote-border);
  margin: 0 0 16px 0;
  background: var(--dv-markdown-blockquote-bg);
}

.markdown-content :deep(code) {
  padding: 0.2em 0.4em;
  margin: 0;
  font-size: 85%;
  background-color: var(--dv-markdown-code-bg);
  color: var(--dv-markdown-pre-text);
  border-radius: 3px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
}

.markdown-content :deep(pre) {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: var(--dv-markdown-pre-bg);
  color: var(--dv-markdown-pre-text);
  border: 1px solid var(--dv-markdown-pre-border);
  border-radius: 6px;
  margin-bottom: 16px;
}

.markdown-content :deep(pre code) {
  display: inline;
  max-width: auto;
  padding: 0;
  margin: 0;
  overflow: visible;
  line-height: inherit;
  word-wrap: normal;
  background-color: transparent;
  border: 0;
}

.markdown-content :deep(table) {
  border-spacing: 0;
  border-collapse: collapse;
  width: 100%;
  margin-bottom: 16px;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 6px 13px;
  border: 1px solid var(--dv-markdown-table-border);
}

.markdown-content :deep(th) {
  font-weight: 600;
  background-color: var(--dv-markdown-table-head-bg);
}

.markdown-content :deep(img) {
  max-width: 100%;
  box-sizing: content-box;
  background-color: var(--dv-preview-body-bg);
}

.markdown-content :deep(a) {
  color: var(--dv-markdown-link);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(hr) {
  height: 0.25em;
  padding: 0;
  margin: 24px 0;
  background-color: var(--dv-markdown-hr);
  border: 0;
}
</style>
