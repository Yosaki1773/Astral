import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import JsonViewer from '@/components/common/JsonViewer.vue';
import JsonTreeNode from '@/components/common/JsonTreeNode.vue';

describe('JsonViewer & JsonTreeNode', () => {
    it('renders empty when data is null or empty', () => {
        const wrapper = mount(JsonViewer, {
            props: {
                data: null
            }
        });
        expect(wrapper.text()).toContain('无数据');
    });

    it('renders JSON tree view for valid JSON object string', async () => {
        const jsonData = JSON.stringify({
            model: 'gpt-4o',
            temperature: 0.7,
            stream: true,
            user: null,
            tags: ['ai', 'test']
        });

        const wrapper = mount(JsonViewer, {
            props: {
                data: jsonData
            }
        });

        // 验证工具栏存在并且识别为 JSON 视图
        expect(wrapper.text()).toContain('JSON 视图');
        expect(wrapper.text()).toContain('Object (5 keys)');

        // 验证树形节点渲染了关键 key 和对应类型 class
        expect(wrapper.text()).toContain('"model"');
        expect(wrapper.text()).toContain('"gpt-4o"');
        expect(wrapper.find('.json-number').text()).toBe('0.7');
        expect(wrapper.find('.json-boolean').text()).toBe('true');
        expect(wrapper.find('.json-null').text()).toBe('null');
    });

    it('supports switching between tree mode and raw code mode', async () => {
        const rawObj = { a: 1, b: 'hello' };
        const wrapper = mount(JsonViewer, {
            props: {
                data: rawObj
            }
        });

        // 默认树形模式
        expect(wrapper.findComponent(JsonTreeNode).exists()).toBe(true);

        // 切换到代码/原始文本模式
        const rawBtn = wrapper.findAll('.toolbar-btn').find(b => b.text() === '代码');
        expect(rawBtn).toBeDefined();
        await rawBtn!.trigger('click');

        expect(wrapper.find('.raw-pre').exists()).toBe(true);
        expect(wrapper.find('.raw-pre').text()).toContain('"a": 1');
    });

    it('supports expanding and collapsing in tree mode', async () => {
        const nestedData = {
            level1: {
                level2: {
                    value: 'deep'
                }
            }
        };

        const wrapper = mount(JsonViewer, {
            props: {
                data: nestedData,
                defaultExpandDepth: 1
            }
        });

        // 点击全部展开
        const expandBtn = wrapper.findAll('.toolbar-btn').find(b => b.text() === '全部展开');
        expect(expandBtn).toBeDefined();
        await expandBtn!.trigger('click');

        expect(wrapper.text()).toContain('"deep"');

        // 点击全部折叠
        const collapseBtn = wrapper.findAll('.toolbar-btn').find(b => b.text() === '全部折叠');
        expect(collapseBtn).toBeDefined();
        await collapseBtn!.trigger('click');

        expect(wrapper.find('.collapsed-preview').exists()).toBe(true);
    });
});
