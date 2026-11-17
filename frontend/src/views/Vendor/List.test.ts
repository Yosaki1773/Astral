import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import VendorList from './List.vue';

vi.mock('@/api/vendor', () => ({
    listVendors: vi.fn().mockResolvedValue({ list: [
        { id: 1, name: 'First', type: 'other', models: [
            { id: 11, model_id: 'upstream-one', system_model_names: ['system-a', 'system-b'] },
            { id: 12, model_id: 'unreferenced', system_model_names: [] },
        ] },
        { id: 2, name: 'Empty', type: 'other', models: [] },
    ], total: 2 }),
    deleteVendor: vi.fn(),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/stores/directory', () => ({ useDirectoryStore: () => ({ invalidateVendors: vi.fn() }) }));
const Slot = defineComponent({ template: '<div><slot /></div>' });
const Table = defineComponent({ props: ['dataSource'], template: '<div><div v-for="record in dataSource" :key="record.id"><slot name="bodyCell" :column="{ key: \'name\' }" :record="record" /></div></div>' });
const Popover = defineComponent({ props: ['placement', 'trigger'], template: '<div class="popover"><slot /><div class="content"><slot name="content" /></div></div>' });


describe('vendor name model preview', () => {
    it('shows configured models and exact system references above each accessible name', async () => {
        const wrapper = mount(VendorList, {
            global: { stubs: { ATable: Table, APopover: Popover, AForm: Slot, AFormItem: Slot, ASpace: Slot, AInput: true, ASelect: true, ASelectOption: true, AButton: true, DialogCreate: true, DialogEdit: true, DialogTest: true } },
        });
        await flushPromises();
        const popovers = wrapper.findAllComponents(Popover);
        expect(popovers[0]!.props('placement')).toBe('top');
        expect(popovers[0]!.props('trigger')).toEqual(['hover', 'focus', 'click']);
        expect(wrapper.findAll('.preview-model')[0]!.text()).toBe('upstream-one 系统模型：system-a、system-b');
        expect(wrapper.findAll('.preview-model')[1]!.text()).toBe('unreferenced');
        expect(wrapper.get('button.vendor-name').attributes('aria-label')).toBe('First：查看配置模型');
        expect(popovers[1]!.text()).toContain('暂无配置模型');
        wrapper.unmount();
    });
});
