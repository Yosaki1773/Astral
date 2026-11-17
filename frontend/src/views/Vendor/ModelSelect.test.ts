import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import ModelSelect from './ModelSelect.vue';

const { fetchDraftVendorModels } = vi.hoisted(() => ({ fetchDraftVendorModels: vi.fn() }));
vi.mock('@/api/vendor', () => ({ fetchDraftVendorModels }));

const Button = defineComponent({
    props: ['disabled', 'loading'], emits: ['click'],
    template: '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
});
const Checkbox = defineComponent({
    props: ['checked', 'disabled'], emits: ['change'],
    template: '<label><input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'change\', $event)" /><slot /></label>',
});
const Input = defineComponent({
    props: ['value'], emits: ['update:value'],
    template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />',
});

function render(initialModelIds: string[] = []) {
    const wrapper = mount(ModelSelect, {
        props: {
            connection: { type: 'other', token: 'draft-token', urls: { openai: 'https://example.com///' }, config: { auth_mode: 'bearer_token' } },
            initialModelIds,
            'onUpdate:modelValue': (ids: string[]) => { void wrapper.setProps({ modelValue: ids }); },
        },
        global: { stubs: { AFormItem: { template: '<div><slot /></div>' }, AButton: Button, ACheckbox: Checkbox, AInput: Input } },
    });
    return wrapper;
}

async function fetchModels(wrapper: ReturnType<typeof render>) {
    await wrapper.findAll('button').find(button => button.text() === '获取模型列表')!.trigger('click');
    await flushPromises();
}


describe('draft vendor model selection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchDraftVendorModels.mockResolvedValue({ models: ['old-model', 'new-model'] });
    });

    it('fetches using current unsaved connection and selects without saving', async () => {
        const wrapper = render();
        await fetchModels(wrapper);
        expect(fetchDraftVendorModels).toHaveBeenCalledWith(wrapper.props('connection'));
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        await wrapper.findAll('input[type=checkbox]')[1]!.setValue(true);
        expect(wrapper.emitted('update:modelValue')!.slice(-1)[0]).toEqual([['new-model']]);
    });

    it('keeps saved models missing upstream and preserves selection on refetch', async () => {
        const wrapper = render(['old-model', 'manual-model']);
        await fetchModels(wrapper);
        expect(wrapper.findAll('label').map(row => row.text())).toEqual(['old-model', 'manual-model', 'new-model']);
        await wrapper.findAll('input[type=checkbox]')[0]!.setValue(false);
        await wrapper.findAll('input[type=checkbox]')[2]!.setValue(true);
        await fetchModels(wrapper);
        expect(wrapper.props('modelValue')).toEqual(['manual-model', 'new-model']);
        expect((wrapper.findAll('input[type=checkbox]')[0]!.element as HTMLInputElement).checked).toBe(false);
        await wrapper.get('input[placeholder="搜索模型名称"]').setValue('NEW');
        expect(wrapper.findAll('label').map(row => row.text())).toEqual(['new-model']);
        await wrapper.findAll('button').find(button => button.text() === '全不选')!.trigger('click');
        expect(wrapper.props('modelValue')).toEqual([]);
    });

    it('ignores responses from changed connection and closed forms', async () => {
        let resolve!: (value: { models: string[] }) => void;
        fetchDraftVendorModels.mockImplementation(() => new Promise(done => { resolve = done; }));
        const wrapper = render();
        await wrapper.get('button').trigger('click');
        await wrapper.setProps({ connection: { type: 'other', token: 'new-token', urls: { openai: 'https://other.com' } } });
        resolve({ models: ['stale-model'] });
        await flushPromises();
        expect(wrapper.text()).not.toContain('stale-model');
        await wrapper.get('button').trigger('click');
        wrapper.unmount();
        resolve({ models: ['closed-model'] });
        await flushPromises();
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('shows inline failure and empty-list feedback', async () => {
        const wrapper = render();
        fetchDraftVendorModels.mockRejectedValueOnce(new Error('Invalid credentials'));
        await fetchModels(wrapper);
        expect(wrapper.get('[role=alert]').text()).toBe('Invalid credentials');
        fetchDraftVendorModels.mockResolvedValueOnce({ models: [] });
        await fetchModels(wrapper);
        expect(wrapper.text()).toContain('未获取到模型列表');
        expect(wrapper.find('[role=alert]').exists()).toBe(false);
    });
});
