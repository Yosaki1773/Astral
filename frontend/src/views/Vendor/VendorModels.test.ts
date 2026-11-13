import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import VendorModels from './VendorModels.vue';

const { getVendor, listVendorModels, fetchVendorModels, syncVendorModels } = vi.hoisted(() => ({
    getVendor: vi.fn(), listVendorModels: vi.fn(), fetchVendorModels: vi.fn(), syncVendorModels: vi.fn(),
}));

vi.mock('@/api/vendor', () => ({
    getVendor, listVendorModels, fetchVendorModels, syncVendorModels,
    addVendorModel: vi.fn(), updateVendorModel: vi.fn(), deleteVendorModel: vi.fn(),
}));
vi.mock('@/utils/requestFeedback', () => ({ notifyRequestError: vi.fn(), notifySuccess: vi.fn() }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: '1' } }), useRouter: () => ({ push: vi.fn() }) }));

const SlotStub = defineComponent({ template: '<div><slot /></div>' });
const ButtonStub = defineComponent({ emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' });
const CheckboxStub = defineComponent({
    props: { checked: Boolean, disabled: Boolean }, emits: ['change', 'click'],
    template: '<input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'change\', $event)" @click.stop="$emit(\'click\', $event)" />',
});

async function openDialog(upstreamModels = ['old-model', 'new-model']) {
    const wrapper = mount(VendorModels, {
        global: {
            stubs: {
                ACheckbox: CheckboxStub, AButton: ButtonStub, AModal: SlotStub,
                ABreadcrumb: SlotStub, ABreadcrumbItem: SlotStub, ACard: SlotStub,
                AForm: SlotStub, AFormItem: SlotStub, ARadioGroup: SlotStub, ACheckboxGroup: SlotStub, ASpace: SlotStub,
                ATable: true, ATag: true, AInput: defineComponent({ inheritAttrs: false, template: '<input />' }), ARadio: true, DialogTest: true,
            },
        },
    });
    fetchVendorModels.mockResolvedValue({ models: upstreamModels });
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text().includes('自动获取'))!.trigger('click');
    await flushPromises();
    return wrapper;
}


describe('VendorModels additive fetch dialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getVendor.mockResolvedValue({ id: 1, name: 'test-vendor' });
        listVendorModels.mockResolvedValue([{ id: 11, vendor_id: 1, model_id: 'old-model', allowed_formats: ['openai'] }]);
        syncVendorModels.mockResolvedValue([]);
    });

    it('marks saved models as added and prevents canceling through the row', async () => {
        const wrapper = await openDialog();
        const row = wrapper.findAll('.model-checkbox-item').find(item => item.text().includes('old-model'))!;
        expect(row.find('.model-saved-tag').text()).toBe('已添加');
        expect((row.get('input').element as HTMLInputElement).disabled).toBe(true);
        await row.trigger('click');
        expect((row.get('input').element as HTMLInputElement).checked).toBe(true);
    });

    it('deselects new models only when clicking 全不选', async () => {
        const wrapper = await openDialog();
        await wrapper.findAll('.model-checkbox-item').find(item => item.text().includes('new-model'))!.trigger('click');
        await wrapper.findAll('button').find(button => button.text() === '全不选')!.trigger('click');
        const rows = wrapper.findAll('.model-checkbox-item');
        expect((rows[0]!.get('input').element as HTMLInputElement).checked).toBe(true);
        expect((rows[1]!.get('input').element as HTMLInputElement).checked).toBe(false);
    });
});
