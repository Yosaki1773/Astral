import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { getRecord } from '@/api/record';
import type { Record } from '@/types/record';
import RecordReplyPreview from './RecordReplyPreview.vue';

vi.mock('@/api/record', () => ({ getRecord: vi.fn() }));

function record(id: number, status: Record['status'], text: string | null = null): Record {
    return {
        id, status,
        start_at: new Date(Date.now() - 10000).toISOString(),
        created_at: new Date(Date.now() - 10000),
        response_data: text === null ? null : JSON.stringify({ model: 'hidden-model', choices: [{ message: { content: text } }] }),
    } as Record;
}

describe('record reply preview', () => {
    let wrapper: VueWrapper | undefined;

    beforeEach(() => {
        vi.mocked(getRecord).mockReset();
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
        vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
    });

    afterEach(() => {
        wrapper?.unmount();
        wrapper = undefined;
        vi.useRealTimers();
    });

    it.each([null, 'init', 'failed'] as const)('is hidden without an eligible selection: %s', async status => {
        wrapper = mount(RecordReplyPreview, { props: { record: status === null ? null : record(1, status) } });
        await flushPromises();
        expect(wrapper.find('section').exists()).toBe(false);
        expect(getRecord).not.toHaveBeenCalled();
    });

    it('renders only formatted reply content for a successful record', async () => {
        vi.mocked(getRecord).mockResolvedValue(record(1, 'success', '# Reply\n\n**bold**\n\n```js\nconst n = 1;\n```'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'success') } });
        await flushPromises();
        expect(wrapper.find('h1').text()).toBe('Reply');
        expect(wrapper.find('strong').text()).toBe('bold');
        expect(wrapper.find('pre code').text()).toContain('const n = 1;');
        expect(wrapper.text()).not.toContain('hidden-model');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('shows elapsed request time while waiting and updates the reply until completion', async () => {
        vi.mocked(getRecord)
            .mockResolvedValueOnce(record(1, 'processing'))
            .mockResolvedValueOnce(record(1, 'processing', '**partial**'))
            .mockResolvedValueOnce(record(1, 'success', '**complete reply**'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await flushPromises();
        expect(wrapper.text()).toContain('等待回复生成');
        expect(wrapper.text()).toContain('10.0 秒');
        await vi.advanceTimersByTimeAsync(500);
        expect(wrapper.text()).toContain('10.5 秒');
        await vi.advanceTimersByTimeAsync(500);
        await flushPromises();
        expect(wrapper.find('strong').text()).toBe('partial');
        expect(wrapper.text()).not.toContain('等待回复生成');
        await vi.advanceTimersByTimeAsync(1000);
        await flushPromises();
        expect(wrapper.find('strong').text()).toBe('complete reply');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(3000);
        expect(getRecord).toHaveBeenCalledTimes(3);
    });

    it('clears the previous reply and ignores a late result after switching records', async () => {
        let resolveOld!: (value: Record) => void;
        vi.mocked(getRecord)
            .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
            .mockResolvedValueOnce(record(2, 'processing'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await wrapper.setProps({ record: record(2, 'processing') });
        await flushPromises();
        resolveOld(record(1, 'success', 'old response'));
        await flushPromises();
        expect(wrapper.text()).not.toContain('old response');
        expect(wrapper.text()).toContain('等待回复生成');
    });

    it('does not leave a previous reply or waiting timer after selecting an ineligible record', async () => {
        vi.mocked(getRecord).mockResolvedValue(record(1, 'processing', 'first response'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await flushPromises();
        expect(wrapper.text()).toContain('first response');
        await wrapper.setProps({ record: record(2, 'failed') });
        expect(wrapper.find('section').exists()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('hides the preview if the selected request subsequently fails', async () => {
        vi.mocked(getRecord).mockResolvedValueOnce(record(1, 'processing', 'partial'))
            .mockResolvedValueOnce(record(1, 'failed', 'upstream error'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await flushPromises();
        await vi.advanceTimersByTimeAsync(1000);
        await flushPromises();
        expect(wrapper.find('section').exists()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears an already visible reply and starts a new waiting clock when switching to a processing record', async () => {
        vi.mocked(getRecord).mockResolvedValueOnce(record(1, 'success', 'previous reply'))
            .mockImplementationOnce(() => new Promise(() => {}));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'success') } });
        await flushPromises();
        expect(wrapper.text()).toContain('previous reply');
        const nextRecord = record(2, 'processing');
        nextRecord.start_at = new Date(Date.now() - 2000).toISOString();
        await wrapper.setProps({ record: nextRecord });
        expect(wrapper.text()).not.toContain('previous reply');
        expect(wrapper.text()).toContain('等待回复生成');
        expect(wrapper.text()).toContain('2.0 秒');
        await vi.advanceTimersByTimeAsync(500);
        expect(wrapper.text()).toContain('2.5 秒');
    });

    it('retries transient errors while processing without overlapping requests', async () => {
        vi.mocked(getRecord).mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce(record(1, 'success', 'recovered'));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await flushPromises();
        expect(wrapper.text()).toContain('回复加载失败');
        await vi.advanceTimersByTimeAsync(1000);
        await flushPromises();
        expect(wrapper.text()).toContain('recovered');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('stops updates and ignores pending requests after unmount', async () => {
        let resolvePending!: (value: Record) => void;
        vi.mocked(getRecord).mockImplementation(() => new Promise(resolve => { resolvePending = resolve; }));
        wrapper = mount(RecordReplyPreview, { props: { record: record(1, 'processing') } });
        await vi.advanceTimersByTimeAsync(2000);
        expect(getRecord).toHaveBeenCalledTimes(1);
        wrapper.unmount();
        wrapper = undefined;
        resolvePending(record(1, 'processing', 'late'));
        await flushPromises();
        expect(vi.getTimerCount()).toBe(0);
    });
});
