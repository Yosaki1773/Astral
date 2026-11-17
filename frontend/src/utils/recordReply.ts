import { Marked, Renderer } from 'marked';
import { convertResponsesResponse } from './responsesConverter';

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isSafeLink(href: string): boolean {
    return /^(https?:\/\/|mailto:|\/|#|\.\.?\/)/i.test(href);
}

const renderer = new Renderer();
const renderLink = renderer.link;
const renderImage = renderer.image;
// 回复来自上游：保留 Markdown 格式，但不执行原始 HTML 或脚本链接。
renderer.html = ({ text }) => escapeHtml(text);
renderer.link = function (token) {
    return isSafeLink(token.href) ? renderLink.call(this, token) : this.parser.parseInline(token.tokens);
};
renderer.image = function (token) {
    return isSafeLink(token.href) ? renderImage.call(this, token) : escapeHtml(token.text);
};
const markdown = new Marked({ gfm: true, breaks: true, renderer });

function renderMarkdown(content: string): string {
    try {
        return markdown.parse(content, { async: false });
    } catch {
        return `<p>${escapeHtml(content)}</p>`;
    }
}

function getReplyText(responseData: string | null): string | null {
    if (!responseData) return null;
    let res: any;
    try {
        res = JSON.parse(responseData);
    } catch {
        return null;
    }
    if (!res) return null;

    if (Array.isArray(res.choices) && res.choices.length > 0) {
        const choice = res.choices[0];
        if (choice.message?.content) {
            return typeof choice.message.content === 'string'
                ? choice.message.content : JSON.stringify(choice.message.content, null, 2);
        }
        if (choice.delta?.content) return choice.delta.content;
    }
    if (Array.isArray(res.content)) {
        return res.content.map((c: any) => typeof c === 'string' ? c : c.text || JSON.stringify(c)).join('\n');
    }
    if (Array.isArray(res.output)) {
        return convertResponsesResponse(res).map(m => typeof m.content === 'string' ? m.content : '')
            .filter(Boolean).join('\n') || null;
    }
    if (res.message?.content) {
        return typeof res.message.content === 'string' ? res.message.content : JSON.stringify(res.message.content, null, 2);
    }
    return null;
}

export default {
    getReplyText,
    renderMarkdown,
};
