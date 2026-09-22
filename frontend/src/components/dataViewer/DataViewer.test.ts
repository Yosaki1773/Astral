import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DataViewer from '@/components/dataViewer/DataViewer.vue';

/**
 * dataViewer 组件测试
 *
 * 该组件由原独立 data_viewer 子项目迁移而来，这里覆盖迁移后的关键契约：
 * - 由 props 驱动（不再依赖 window.gt_bridge 全局桥接）
 * - 根据数据类型自动选择 LLM 对话 / Markdown 渲染器
 */
describe('DataViewer', () => {
    it('renders empty state when no data provided', () => {
        const wrapper = mount(DataViewer, {
            props: { data: null }
        });

        expect(wrapper.find('.data-viewer-root').exists()).toBe(true);
        expect(wrapper.text()).toContain('empty data');
    });

    it('renders llm conversation from messages array', () => {
        const wrapper = mount(DataViewer, {
            props: {
                data: {
                    messages: [
                        { role: 'system', content: 'You are a concise assistant.' },
                        { role: 'user', content: 'Hello there' },
                        { role: 'assistant', content: 'Hi, how can I help?' }
                    ]
                }
            }
        });

        expect(wrapper.find('.chat-page').exists()).toBe(true);
        expect(wrapper.text()).toContain('Conversation Viewer');
        expect(wrapper.text()).toContain('Hello there');
        expect(wrapper.text()).toContain('Hi, how can I help?');
    });

    it('renders llm conversation from a bare messages array', () => {
        const wrapper = mount(DataViewer, {
            props: {
                data: [{ role: 'user', content: 'Bare array message' }]
            }
        });

        expect(wrapper.find('.chat-page').exists()).toBe(true);
        expect(wrapper.text()).toContain('Bare array message');
    });

    it('renders markdown when data is a plain string', () => {
        const wrapper = mount(DataViewer, {
            props: { data: '# Markdown Heading\n\nSome paragraph text.' }
        });

        expect(wrapper.find('.markdown-viewer').exists()).toBe(true);
        expect(wrapper.find('h1').text()).toBe('Markdown Heading');
        expect(wrapper.text()).toContain('Some paragraph text.');
    });

    it('honours an explicit dataType override', () => {
        const wrapper = mount(DataViewer, {
            props: {
                data: '{"messages":[{"role":"user","content":"x"}]}',
                dataType: 'markdown'
            }
        });

        expect(wrapper.find('.markdown-viewer').exists()).toBe(true);
        expect(wrapper.find('.chat-page').exists()).toBe(false);
    });

    it('applies the embedded modifier class', () => {
        const wrapper = mount(DataViewer, {
            props: {
                data: [{ role: 'user', content: 'hi' }],
                embedded: true
            }
        });

        expect(wrapper.find('.data-viewer-root').classes()).toContain('data-viewer-embedded');
    });
});
