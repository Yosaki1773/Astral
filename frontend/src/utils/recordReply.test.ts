import { describe, expect, it } from 'vitest';
import recordReply from './recordReply';

describe('record reply formatting', () => {
    it.each([
        { response: { choices: [{ message: { content: 'OpenAI reply' } }] }, expected: 'OpenAI reply' },
        { response: { choices: [{ delta: { content: 'partial reply' } }] }, expected: 'partial reply' },
        { response: { content: [{ type: 'text', text: 'Anthropic reply' }] }, expected: 'Anthropic reply' },
        { response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Responses reply' }] }] }, expected: 'Responses reply' },
        { response: { message: { content: 'message reply' } }, expected: 'message reply' },
    ])('extracts reply text from $expected', ({ response, expected }) => {
        expect(recordReply.getReplyText(JSON.stringify(response))).toBe(expected);
    });

    it('does not show a JSON object, tool metadata or a parse error as reply text', () => {
        expect(recordReply.getReplyText(null)).toBeNull();
        expect(recordReply.getReplyText('not JSON')).toBeNull();
        expect(recordReply.getReplyText('{"output":[{"type":"function_call","name":"tool"}]}')).toBeNull();
    });

    it('formats headings, lists, code, tables and line breaks like the detail preview', () => {
        const html = recordReply.renderMarkdown('# Title\n\n- item\n\n```js\nconst n = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nfirst\nsecond');
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<li>item</li>');
        expect(html).toContain('<pre><code class="language-js">');
        expect(html).toContain('<table>');
        expect(html).toContain('<br>');
    });

    it('does not execute raw HTML or script URLs from an upstream reply', () => {
        const html = recordReply.renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![x](data:text/html,test)\n\n[safe](https://example.test)');
        const node = document.createElement('div');
        node.innerHTML = html;
        expect(node.querySelector('script')).toBeNull();
        expect(node.querySelector('img')).toBeNull();
        expect(node.querySelectorAll('a')).toHaveLength(1);
        expect(node.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    });
});
