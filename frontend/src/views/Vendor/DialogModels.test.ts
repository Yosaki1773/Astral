import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import DialogCreate from './DialogCreate.vue';
import DialogEdit from './DialogEdit.vue';
import ModelSelect from './ModelSelect.vue';

const api = vi.hoisted(() => ({ createVendor: vi.fn(), updateVendor: vi.fn(), listVendorModels: vi.fn(), fetchDraftVendorModels: vi.fn() }));
vi.mock('@/api/vendor', () => ({ ...api, getVendorPresetUrls: vi.fn().mockResolvedValue({ openai: { label: 'OpenAI', openai: 'https://preset.test/v1' } }) }));
vi.mock('@/stores/directory', () => ({ useDirectoryStore: () => ({ invalidateVendors: vi.fn() }) }));
vi.mock('@/utils/requestFeedback', () => ({ notifySuccess: vi.fn(), notifyRequestError: vi.fn() }));

const Slot = defineComponent({ template: '<div><slot /></div>' });
const Modal = defineComponent({
    props: ['open', 'okButtonProps'], emits: ['ok', 'cancel'],
    template: '<div v-if="open"><slot /><button :disabled="okButtonProps?.disabled" @click="$emit(\'ok\')">保存</button><button @click="$emit(\'cancel\')">取消</button></div>',
});
const Form = defineComponent({
    setup(_, { expose }) { expose({ validate: () => Promise.resolve() }); },
    template: '<form><slot /></form>',
});
const Input = defineComponent({ props: ['value'], emits: ['update:value'], template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />' });
const Button = defineComponent({ props: ['disabled', 'loading'], emits: ['click'], template: '<button type="button" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>' });
const Checkbox = defineComponent({ props: ['checked'], emits: ['change'], template: '<label><input type="checkbox" :checked="checked" @change="$emit(\'change\', $event)" /><slot /></label>' });
const stubs = {
    AModal: Modal, AForm: Form, AFormItem: Slot, AInput: Input, AInputPassword: Input,
    AButton: Button, ACheckbox: Checkbox, ASelect: defineComponent({ inheritAttrs: false, template: '<div />' }), ASelectOption: true, ARow: Slot, ACol: Slot, ATag: true, ASwitch: true, SettingsCollapse: Slot,
};
const vendor = { id: 7, type: 'other', name: 'Existing', token: 'saved-token', urls: { anthropic: 'https://saved.test' }, config: { auth_mode: 'api_key', skip_tls_verify: true } };

async function render(edit: boolean) {
    const wrapper = mount(edit ? DialogEdit : DialogCreate, { global: { stubs } });
    if (edit) await (wrapper.vm as any).open(vendor);
    else (wrapper.vm as any).open();
    await flushPromises();
    return wrapper;
}

async function click(wrapper: Awaited<ReturnType<typeof render>>, text: string) {
    await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click');
    await flushPromises();
}


describe('vendor dialogs model configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.listVendorModels.mockResolvedValue([{ model_id: 'saved-model' }]);
        api.fetchDraftVendorModels.mockResolvedValue({ models: ['new-model'] });
        api.createVendor.mockResolvedValue({ id: 8 });
        api.updateVendor.mockResolvedValue(vendor);
    });

    it.each([false, true])('saves selected models with current form values (edit=%s)', async edit => {
        const wrapper = await render(edit);
        await wrapper.get('input[placeholder="请输入 API Token"]').setValue('unsaved-token');
        await click(wrapper, '获取模型列表');
        expect(api.createVendor).not.toHaveBeenCalled();
        expect(api.updateVendor).not.toHaveBeenCalled();
        expect(api.fetchDraftVendorModels.mock.calls[0]![0]).toMatchObject({ token: 'unsaved-token' });
        if (edit) {
            expect(api.fetchDraftVendorModels.mock.calls[0]![0]).toMatchObject({ urls: vendor.urls, config: vendor.config });
            expect((wrapper.findAll('input[type=checkbox]')[0]!.element as HTMLInputElement).checked).toBe(true);
        }
        await click(wrapper, '全选');
        await click(wrapper, '保存');
        const data = edit ? api.updateVendor.mock.calls[0]![1] : api.createVendor.mock.calls[0]![0];
        expect(data).toMatchObject({ token: 'unsaved-token', model_ids: edit ? ['saved-model', 'new-model'] : ['new-model'] });
        wrapper.unmount();
    });

    it('does not overwrite model configuration when edit selection is untouched', async () => {
        const wrapper = await render(true);
        await click(wrapper, '保存');
        expect(api.updateVendor.mock.calls[0]![1]).not.toHaveProperty('model_ids');
        wrapper.unmount();
    });

    it.each([false, true])('cancel discards draft models and reopening resets selection (edit=%s)', async edit => {
        const wrapper = await render(edit);
        await wrapper.get('input[placeholder="请输入 API Token"]').setValue('draft-token');
        await click(wrapper, '获取模型列表');
        await click(wrapper, '全选');
        await click(wrapper, '取消');
        expect(api.createVendor).not.toHaveBeenCalled();
        expect(api.updateVendor).not.toHaveBeenCalled();
        if (edit) await (wrapper.vm as any).open(vendor);
        else (wrapper.vm as any).open();
        await flushPromises();
        expect(wrapper.getComponent(ModelSelect).props('modelValue')).toBeUndefined();
        expect(wrapper.text()).not.toContain('new-model');
        wrapper.unmount();
    });
});
