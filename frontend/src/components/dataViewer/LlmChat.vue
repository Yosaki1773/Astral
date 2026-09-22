<template>
  <div class="chat-page">
    <div class="chat-backdrop"></div>

    <div ref="scrollContainer" class="chat-scroll">
      <main class="chat-shell">
        <section class="chat-hero" :class="{ 'chat-hero-collapsed': heroCollapsed }">
          <button class="chat-hero-toggle" type="button" @click="toggleHero">
            <div class="chat-hero-summary">
              <div class="chat-hero-summary-main">
                <div class="chat-hero-eyebrow">Conversation</div>
                <div class="chat-hero-title-row">
                  <h1 class="chat-hero-title">Conversation Viewer</h1>
                  <a-tag class="hero-tag" color="blue">{{ conversationMeta.providerLabel }}</a-tag>
                </div>
              </div>

              <div class="chat-hero-summary-stats">
                <div class="chat-hero-summary-pill">
                  <span class="chat-hero-summary-pill-label">Messages</span>
                  <strong>{{ conversationMeta.messageCount }}</strong>
                </div>
                <div class="chat-hero-summary-pill">
                  <span class="chat-hero-summary-pill-label">System</span>
                  <strong>{{ conversationMeta.hasSystem ? 'Present' : 'None' }}</strong>
                </div>
                <span class="chat-hero-toggle-indicator">{{ heroCollapsed ? 'Expand' : 'Collapse' }}</span>
              </div>
            </div>

            <div v-if="!heroCollapsed" class="chat-hero-expanded">
              <div class="chat-hero-copy">
                <a-typography-paragraph>
                  Web renderer for structured LLM conversations, including Anthropic blocks,
                  OpenAI tool calls, and system prompts.
                </a-typography-paragraph>
              </div>

              <div class="chat-hero-panel">
                <div class="chat-hero-panel-title">Session Overview</div>
                <div class="chat-hero-stats">
                  <div class="chat-hero-stat">
                    <div class="chat-hero-stat-label">Provider</div>
                    <div class="chat-hero-stat-value">{{ conversationMeta.providerLabel }}</div>
                  </div>
                  <div class="chat-hero-stat">
                    <div class="chat-hero-stat-label">Messages</div>
                    <div class="chat-hero-stat-value">{{ conversationMeta.messageCount }}</div>
                  </div>
                  <div class="chat-hero-stat">
                    <div class="chat-hero-stat-label">System Prompt</div>
                    <div class="chat-hero-stat-value">
                      {{ conversationMeta.hasSystem ? 'Present' : 'None' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </button>
        </section>

        <section
          ref="threadViewport"
          class="chat-thread-viewport"
        >
          <div
            class="chat-thread"
            :style="{ height: `${Math.max(virtualThreadHeight, viewportHeight)}px` }"
          >
          <article
            v-for="message in visibleMessages"
            :key="message.id"
            class="message-row"
            :class="[`message-row-${message.role}`, { 'message-row-highlighted': highlightedMessageId === message.id }]"
            :style="{ top: `${message.offsetTop}px` }"
            :ref="(el) => setMessageElement(message.id, el)"
          >
            <div class="message-card" :class="`message-card-${message.role}`">
              <header class="message-header">
                <div class="message-author">
                  <a-avatar
                    :size="40"
                    :style="{ background: message.avatarGradient, color: '#ffffff' }"
                  >
                    <component :is="message.avatarIcon" />
                  </a-avatar>
                  <div>
                    <div class="message-role">{{ message.roleLabel }}</div>
                    <div class="message-subtitle">{{ message.subtitle }}</div>
                  </div>
                </div>

                <div class="message-tags">
                  <a-tag v-if="message.sequenceLabel" class="card-tag message-sequence-tag">
                    {{ message.sequenceLabel }}
                  </a-tag>
                  <a-tag v-for="tag in message.tags" :key="tag" class="card-tag">{{ tag }}</a-tag>
                </div>
              </header>

              <div class="message-sections">
                <section
                  v-for="section in getMessageSections(message)"
                  :key="section.id"
                  class="message-section"
                  :class="`message-section-${section.tone}`"
                >
                  <div v-if="section.label || section.badge || section.meta" class="section-heading">
                    <a-tag v-if="section.label" class="card-tag">{{ section.label }}</a-tag>
                    <div v-if="section.badge" class="section-kv">
                      <a-tag class="card-tag">{{ `${section.badgeLabel || 'Label'}: ${section.badge}` }}</a-tag>
                    </div>
                    <div v-if="section.meta" class="section-kv">
                      <a-tag class="card-tag">{{ `${section.metaLabel || 'Meta'}: ${section.meta}` }}</a-tag>
                    </div>
                  </div>

                  <div
                    v-if="section.kind === 'markdown'"
                    class="section-markdown markdown-content"
                    v-html="renderMarkdown(section)"
                  ></div>

                  <pre v-else class="section-code"><code>{{ section.code }}</code></pre>
                </section>
              </div>
            </div>
          </article>
          </div>
        </section>
      </main>
    </div>

    <!-- 侧边目录悬浮框 -->
    <aside
      v-if="baseMessages.length > 0"
      class="chat-toc"
      :class="{ 'chat-toc-collapsed': tocCollapsed }"
    >
      <div v-if="tocCollapsed" class="chat-toc-bubble" @click="tocCollapsed = false" title="展开消息目录">
        <UnorderedListOutlined class="chat-toc-bubble-icon" />
        <span class="chat-toc-bubble-badge">{{ baseMessages.length }}</span>
      </div>

      <div v-else class="chat-toc-panel">
        <header class="chat-toc-header">
          <div class="chat-toc-title">
            <UnorderedListOutlined />
            <span>消息目录 ({{ baseMessages.length }})</span>
          </div>
          <div class="chat-toc-actions">
            <button class="chat-toc-btn" @click="scrollToTop" title="回到顶部">
              <VerticalAlignTopOutlined />
            </button>
            <button class="chat-toc-btn" @click="tocCollapsed = true" title="收起目录">
              <CloseOutlined />
            </button>
          </div>
        </header>

        <div class="chat-toc-list">
          <div
            v-for="msg in baseMessages"
            :key="msg.id"
            class="chat-toc-item"
            :class="[
              `chat-toc-item-${msg.role}`,
              { 'chat-toc-item-active': activeMessageId === msg.id }
            ]"
            @click="scrollToMessage(msg.id)"
          >
            <div class="chat-toc-item-header">
              <span class="chat-toc-badge" :class="`chat-toc-badge-${msg.role}`">
                {{ msg.sequenceLabel }}
              </span>
              <span class="chat-toc-role">{{ msg.roleLabel }}</span>
            </div>
            <div class="chat-toc-snippet">
              {{ msg.snippet || '(空消息)' }}
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<script>
import { nextTick } from 'vue';
import {
  ApartmentOutlined,
  RobotOutlined,
  ToolOutlined,
  UserOutlined,
  UnorderedListOutlined,
  CloseOutlined,
  VerticalAlignTopOutlined
} from '@ant-design/icons-vue';
import { marked } from 'marked';

const ROLE_META = {
  user: {
    label: 'User',
    subtitle: 'Input',
    avatarIcon: UserOutlined,
    avatarGradient: 'linear-gradient(135deg, #fb923c 0%, #f59e0b 100%)',
    tags: ['prompt']
  },
  assistant: {
    label: 'Assistant',
    subtitle: 'Model output',
    avatarIcon: RobotOutlined,
    avatarGradient: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)',
    tags: ['response']
  },
  system: {
    label: 'System',
    subtitle: 'Instruction layer',
    avatarIcon: ApartmentOutlined,
    avatarGradient: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
    tags: ['context']
  },
  tool: {
    label: 'Tool',
    subtitle: 'Execution result',
    avatarIcon: ToolOutlined,
    avatarGradient: 'linear-gradient(135deg, #2dd4bf 0%, #0f766e 100%)',
    tags: ['runtime']
  }
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAnthropicBlock(value) {
  return isObject(value) && typeof value.type === 'string';
}

function isAnthropicBlockArray(value) {
  return Array.isArray(value) && value.every(isAnthropicBlock);
}

function looksLikeAnthropicMessage(message) {
  if (!isObject(message) || typeof message.role !== 'string') {
    return false;
  }

  if (!('content' in message)) {
    return false;
  }

  return typeof message.content === 'string' || isAnthropicBlockArray(message.content);
}

function looksLikeAnthropicMessageArray(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.every(looksLikeAnthropicMessage);
}

function normalizeText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  if (Array.isArray(value) || isObject(value)) {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function createMarkdownSection(baseId, text, options = {}) {
  const content = normalizeText(text);
  if (!content.trim()) {
    return null;
  }

  return {
    id: baseId,
    kind: 'markdown',
    tone: options.tone || 'default',
    label: options.label || '',
    badge: options.badge || '',
    badgeLabel: options.badgeLabel || '',
    meta: options.meta || '',
    metaLabel: options.metaLabel || '',
    content
  };
}

function createCodeSection(baseId, label, value, options = {}) {
  const content = normalizeText(value);
  if (!content.trim()) {
    return null;
  }

  return {
    id: baseId,
    kind: 'code',
    tone: options.tone || 'default',
    label,
    badge: options.badge || '',
    badgeLabel: options.badgeLabel || '',
    meta: options.meta || '',
    metaLabel: options.metaLabel || '',
    code: content
  };
}

const TRANSCRIPT_TAG_PATTERN = /<([a-z0-9-]+)>([\s\S]*?)<\/\1>/gi;

function normalizeTaggedText(text, baseId) {
  const rawText = normalizeText(text);
  const matches = [...rawText.matchAll(TRANSCRIPT_TAG_PATTERN)];

  if (!matches.length) {
    return [createMarkdownSection(baseId, rawText)].filter(Boolean);
  }

  const sections = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const [fullMatch, tagName, innerText] = match;
    const start = match.index || 0;
    const plainText = rawText.slice(cursor, start);

    if (plainText.trim()) {
      sections.push(createMarkdownSection(`${baseId}-text-${index}`, plainText));
    }

    sections.push(...createTaggedSection(tagName, innerText, `${baseId}-tag-${index}`));
    cursor = start + fullMatch.length;
  });

  const trailingText = rawText.slice(cursor);
  if (trailingText.trim()) {
    sections.push(createMarkdownSection(`${baseId}-tail`, trailingText));
  }

  return sections.filter(Boolean);
}

function formatTagLabel(tagName) {
  return `<${tagName}>`;
}

function getTaggedSectionOptions(tagName) {
  if (tagName.includes('stdout') || tagName.includes('stderr') || tagName.includes('args')) {
    return {
      kind: 'code',
      tone: tagName.includes('stderr') ? 'error' : 'transcript-code'
    };
  }

  if (tagName.includes('reminder')) {
    return {
      kind: 'markdown',
      tone: 'default'
    };
  }

  if (tagName.includes('caveat')) {
    return {
      kind: 'markdown',
      tone: 'default'
    };
  }

  if (tagName.includes('command')) {
    return {
      kind: 'markdown',
      tone: 'default'
    };
  }

  return {
    kind: 'markdown',
    tone: 'default'
  };
}

function createTaggedSection(tagName, innerText, baseId) {
  const content = normalizeText(innerText);

  const options = getTaggedSectionOptions(tagName);
  const label = formatTagLabel(tagName);

  if (!content.trim()) {
    return [];
  }

  if (options.kind === 'code') {
    return [
      createCodeSection(baseId, label, content, {
        tone: options.tone
      })
    ].filter(Boolean);
  }

  const normalizedContent = tagName === 'command-name' ? `\`${content}\`` : content;
  return [
    createMarkdownSection(baseId, normalizedContent, {
      tone: options.tone,
      label
    })
  ].filter(Boolean);
}

function normalizeAnthropicBlock(block, baseId) {
  if (!isObject(block)) {
    return normalizeTaggedText(block, baseId);
  }

  switch (block.type) {
    case 'text':
      return normalizeTaggedText(block.text, baseId);
    case 'thinking':
    case 'redacted_thinking':
      return [
        createCodeSection(baseId, 'Thinking', block.thinking || block.data || '', {
          tone: 'thinking'
        })
      ].filter(Boolean);
    case 'tool_use':
      return [
        createCodeSection(baseId, 'Tool Call', block.input || {}, {
          tone: 'tool',
          badge: block.name || 'unknown',
          badgeLabel: 'Tool',
          meta: block.id || '',
          metaLabel: 'Call ID'
        })
      ].filter(Boolean);
    case 'tool_result': {
      const content = block.content;
      const meta = block.tool_use_id || '';

      if (Array.isArray(content)) {
        const sections = content.flatMap((item, index) =>
          normalizeAnthropicBlock(item, `${baseId}-${index}`)
        );

        if (sections.length) {
          sections[0] = {
            ...sections[0],
            label: sections[0].label || 'Tool Result',
            meta: sections[0].meta || meta,
            metaLabel: sections[0].metaLabel || 'Call ID'
          };
        }

        return sections;
      }

      return [
        createCodeSection(baseId, block.is_error ? 'Tool Error' : 'Tool Result', content, {
          tone: block.is_error ? 'error' : 'tool-result',
          meta,
          metaLabel: 'Call ID'
        })
      ].filter(Boolean);
    }
    default:
      return [
        createCodeSection(baseId, `Block · ${block.type || 'unknown'}`, block, {
          tone: 'default'
        })
      ].filter(Boolean);
  }
}

function normalizeOpenAiToolCalls(toolCalls, baseId) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.map((toolCall, index) => {
    const functionInfo = toolCall?.function || {};
    let args = functionInfo.arguments;

    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch (_error) {
        return createCodeSection(`${baseId}-${index}`, 'Tool Call', args, {
          tone: 'tool',
          badge: functionInfo.name || 'unknown',
          badgeLabel: 'Tool',
          meta: toolCall?.id || '',
          metaLabel: 'Call ID'
        });
      }
    }

    return createCodeSection(`${baseId}-${index}`, 'Tool Call', args || {}, {
      tone: 'tool',
      badge: functionInfo.name || 'unknown',
      badgeLabel: 'Tool',
      meta: toolCall?.id || '',
      metaLabel: 'Call ID'
    });
  }).filter(Boolean);
}

function normalizeMessageSections(message, messageId) {
  const sections = [];

  const thinkingContent = message.reasoning_content ?? message.thinking;
  if (thinkingContent != null) {
    const thinkingSection = createCodeSection(
      `${messageId}-thinking`,
      'Thinking',
      thinkingContent,
      { tone: 'thinking' }
    );
    if (thinkingSection !== null) {
      sections.push(thinkingSection);
    }
  }

  if (Array.isArray(message.content)) {
    sections.push(
      ...message.content.flatMap((block, index) =>
        normalizeAnthropicBlock(block, `${messageId}-block-${index}`)
      )
    );
  } else if (message.content != null) {
    sections.push(...normalizeTaggedText(message.content, `${messageId}-content`));
  }

  if (message.tool_calls) {
    sections.push(...normalizeOpenAiToolCalls(message.tool_calls, `${messageId}-tool`));
  }

  if (message.role === 'tool') {
    return [
      createCodeSection(`${messageId}-tool-result`, 'Tool Result', message.content, {
        tone: 'tool-result',
        badge: message.name || 'anonymous',
        badgeLabel: 'Tool',
        meta: message.tool_call_id || message.tool_use_id || '',
        metaLabel: 'Call ID'
      })
    ].filter(Boolean);
  }

  return sections.filter(Boolean);
}

function normalizeConversation(rawConversation) {
  if (Array.isArray(rawConversation)) {
    return {
      provider: looksLikeAnthropicMessageArray(rawConversation)
        ? 'Anthropic-style messages[]'
        : 'OpenAI-style messages[]',
      system: [],
      messages: rawConversation
    };
  }

  if (isObject(rawConversation) && Array.isArray(rawConversation.messages)) {
    const isAnthropicObject = 'system' in rawConversation || looksLikeAnthropicMessageArray(rawConversation.messages);
    return {
      provider: isAnthropicObject ? 'Anthropic-style object' : 'OpenAI-style object',
      system: isAnthropicObject ? rawConversation.system : [],
      messages: rawConversation.messages
    };
  }

  return {
    provider: 'Conversation',
    system: [],
    messages: []
  };
}

function hasRenderableText(value) {
  return normalizeText(value).trim().length > 0;
}

function hasRenderableAnthropicBlock(block) {
  if (!isObject(block)) {
    return hasRenderableText(block);
  }

  switch (block.type) {
    case 'text':
      return hasRenderableText(block.text);
    case 'thinking':
    case 'redacted_thinking':
      return hasRenderableText(block.thinking || block.data || '');
    case 'tool_use':
      return hasRenderableText(block.input || {});
    case 'tool_result':
      return Array.isArray(block.content)
        ? block.content.some(hasRenderableAnthropicBlock)
        : hasRenderableText(block.content);
    default:
      return hasRenderableText(block);
  }
}

function hasRenderableMessage(message) {
  if (!isObject(message) || !message.role) {
    return false;
  }

  if (message.role === 'tool') {
    return hasRenderableText(message.content);
  }

  if (Array.isArray(message.content) && message.content.some(hasRenderableAnthropicBlock)) {
    return true;
  }

  if (message.content != null && hasRenderableText(message.content)) {
    return true;
  }

  const thinkingContent = message.reasoning_content ?? message.thinking;
  if (thinkingContent != null && hasRenderableText(thinkingContent)) {
    return true;
  }

  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

function getMessageFlags(message) {
  const thinkingContent = message?.reasoning_content ?? message?.thinking;
  const flags = {
    hasThinking: thinkingContent != null && normalizeText(thinkingContent).trim().length > 0,
    hasToolCall: Array.isArray(message?.tool_calls) && message.tool_calls.length > 0,
    hasToolResult: message?.role === 'tool'
  };

  if (!Array.isArray(message?.content)) {
    return flags;
  }

  message.content.forEach((block) => {
    if (!isObject(block)) {
      return;
    }

    if (block.type === 'thinking' || block.type === 'redacted_thinking') {
      flags.hasThinking = true;
    }

    if (block.type === 'tool_use') {
      flags.hasToolCall = true;
    }

    if (block.type === 'tool_result') {
      flags.hasToolResult = true;
    }
  });

  return flags;
}

function estimateTextSize(value) {
  if (typeof value === 'string') {
    return value.length;
  }

  if (value == null) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + estimateTextSize(item), 0);
  }

  if (isObject(value)) {
    if ('text' in value) {
      return estimateTextSize(value.text);
    }

    if ('content' in value) {
      return estimateTextSize(value.content);
    }

    if ('input' in value) {
      return estimateTextSize(value.input);
    }

    return JSON.stringify(value).length;
  }

  return String(value).length;
}

function extractMessageSnippet(message) {
  if (!message) return '';
  if (message.id === 'system-root') {
    const sys = typeof message.systemValue === 'string'
      ? message.systemValue
      : Array.isArray(message.systemValue)
        ? message.systemValue.map(b => b?.text || '').join(' ')
        : '';
    return cleanSnippetText(sys);
  }

  const raw = message.rawMessage;
  if (!raw) return '';

  if (typeof raw.content === 'string' && raw.content.trim()) {
    return cleanSnippetText(raw.content);
  }

  if (Array.isArray(raw.content)) {
    for (const block of raw.content) {
      if (block.type === 'text' && block.text) {
        return cleanSnippetText(block.text);
      }
      if (block.type === 'thinking' && block.thinking) {
        return cleanSnippetText(block.thinking);
      }
      if (block.type === 'tool_use' && block.name) {
        return cleanSnippetText(`[Tool Use] ${block.name}`);
      }
      if (block.type === 'tool_result') {
        const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '');
        return cleanSnippetText(`[Result] ${text}`);
      }
    }
  }

  const thinking = raw.reasoning_content ?? raw.thinking;
  if (thinking && typeof thinking === 'string' && thinking.trim()) {
    return cleanSnippetText(thinking);
  }

  if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
    const fn = raw.tool_calls[0]?.function?.name || 'tool';
    return cleanSnippetText(`[Tool Call] ${fn}`);
  }

  if (raw.content != null) {
    return cleanSnippetText(String(raw.content));
  }

  return '';
}

function cleanSnippetText(str) {
  if (!str) return '';
  const cleaned = str
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*`_~>\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 45);
}

const ROW_GAP = 12;
const VIRTUAL_OVERSCAN = 1200;
const FALLBACK_VIEWPORT_HEIGHT = 900;

export default {
  name: 'LlmChat',
  components: {
    UnorderedListOutlined,
    CloseOutlined,
    VerticalAlignTopOutlined
  },
  props: {
    // 对话数据（替代原独立项目的全局 store）
    data: {
      type: [Array, Object],
      default: null
    }
  },
  data() {
    return {
      heroCollapsed: true,
      scrollTop: 0,
      viewportHeight: 0,
      threadViewportTop: 0,
      heightCache: {},
      sectionCache: {},
      markdownCache: {},
      tocCollapsed: false,
      activeMessageId: null,
      highlightedMessageId: null,
      highlightTimer: null
    };
  },
  created() {
    this.messageElements = {};
    this.messageResizeObserver = null;
    this.viewportResizeObserver = null;
    this.scrollFrame = null;
    this.pendingHeights = {};
    this.heightFrame = null;
  },
  computed: {
    normalizedConversation() {
      return normalizeConversation(this.data);
    },
    conversationMeta() {
      return {
        providerLabel: this.normalizedConversation.provider,
        messageCount: this.baseMessages.length,
        hasSystem: this.baseMessages.some((item) => item.role === 'system')
      };
    },
    baseMessages() {
      const messages = [];
      const systemValue = this.normalizedConversation.system;

      if (typeof systemValue === 'string' && systemValue.trim()) {
        const meta = ROLE_META.system;
        messages.push({
          id: 'system-root',
          role: 'system',
          sequenceLabel: 'System',
          systemValue,
          roleLabel: meta.label,
          subtitle: meta.subtitle,
          avatarIcon: meta.avatarIcon,
          avatarGradient: meta.avatarGradient,
          tags: [...meta.tags],
          snippet: extractMessageSnippet({ id: 'system-root', systemValue })
        });
      } else if (Array.isArray(systemValue) && systemValue.some(hasRenderableAnthropicBlock)) {
        const meta = ROLE_META.system;
        messages.push({
          id: 'system-root',
          role: 'system',
          sequenceLabel: 'System',
          systemValue,
          roleLabel: meta.label,
          subtitle: meta.subtitle,
          avatarIcon: meta.avatarIcon,
          avatarGradient: meta.avatarGradient,
          tags: [...meta.tags],
          snippet: extractMessageSnippet({ id: 'system-root', systemValue })
        });
      }

      this.normalizedConversation.messages.forEach((message, index) => {
        if (!hasRenderableMessage(message)) {
          return;
        }

        const meta = ROLE_META[message.role] || ROLE_META.assistant;
        const flags = getMessageFlags(message);
        const tags = [...meta.tags];

        if (flags.hasThinking) {
          tags.push('thinking');
        }
        if (flags.hasToolCall) {
          tags.push('tool call');
        }
        if (flags.hasToolResult) {
          tags.push('tool result');
        }

        const msgObj = {
          id: `message-${index}`,
          role: message.role,
          name: message.name || '',
          sequenceLabel: `#${index}`,
          rawMessage: message,
          roleLabel: meta.label,
          subtitle: meta.subtitle,
          avatarIcon: meta.avatarIcon,
          avatarGradient: meta.avatarGradient,
          tags: [...new Set(tags)]
        };
        msgObj.snippet = extractMessageSnippet(msgObj);

        messages.push(msgObj);
      });

      return messages;
    },
    messageLayouts() {
      let offsetTop = 0;

      return this.baseMessages.map((message) => {
        const estimatedHeight = this.heightCache[message.id] || this.estimateMessageHeight(message);
        const layout = {
          ...message,
          offsetTop,
          estimatedHeight
        };

        offsetTop += estimatedHeight + ROW_GAP;
        return layout;
      });
    },
    virtualThreadHeight() {
      if (!this.messageLayouts.length) {
        return 0;
      }

      const lastMessage = this.messageLayouts[this.messageLayouts.length - 1];
      return lastMessage.offsetTop + lastMessage.estimatedHeight;
    },
    visibleMessages() {
      const layouts = this.messageLayouts;
      if (!layouts.length) return [];

      const viewportHeight = this.viewportHeight || FALLBACK_VIEWPORT_HEIGHT;
      const threadWindowTop = Math.max(this.scrollTop - this.threadViewportTop, 0);
      const windowTop = Math.max(threadWindowTop - VIRTUAL_OVERSCAN, 0);
      const windowBottom = threadWindowTop + viewportHeight + VIRTUAL_OVERSCAN;

      // Binary search for the first visible message
      let low = 0;
      let high = layouts.length - 1;
      let startIndex = 0;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (layouts[mid].offsetTop + layouts[mid].estimatedHeight >= windowTop) {
          startIndex = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      const visible = [];
      for (let i = startIndex; i < layouts.length; i++) {
        const message = layouts[i];
        if (message.offsetTop > windowBottom) break;
        visible.push(message);
      }

      return visible;
    }
  },
  watch: {
    baseMessages: {
      handler() {
        this.resetVirtualState();
      },
      immediate: true
    }
  },
  mounted() {
    this.messageResizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => { 
        const messageId = entry.target.dataset.messageId;

        if (messageId) {
          this.updateMessageHeight(messageId, entry.target.getBoundingClientRect().height);
        }
      });
    });

    // Observe any elements that were mounted before the observer was created
    Object.values(this.messageElements).forEach((element) => {
      if (element) {
        this.messageResizeObserver.observe(element);
      }
    });

    this.viewportResizeObserver = new ResizeObserver(() => {
      this.updateViewportMetrics();
    });

    if (this.$refs.threadViewport) {
      this.viewportResizeObserver.observe(this.$refs.threadViewport);
    }

    if (this.$refs.scrollContainer) {
      this.viewportResizeObserver.observe(this.$refs.scrollContainer);
    }

    if (typeof window !== 'undefined') {
      if (this.$refs.scrollContainer) {
        this.$refs.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });
      }
      window.addEventListener('resize', this.updateViewportMetrics, { passive: true });
    }

    this.updateViewportMetrics();
  },
  beforeUnmount() {
    if (this.messageResizeObserver) {
      this.messageResizeObserver.disconnect();
    }

    if (this.viewportResizeObserver) {
      this.viewportResizeObserver.disconnect();
    }

    if (this.heightFrame) {
      cancelAnimationFrame(this.heightFrame);
    }

    if (typeof window !== 'undefined') {
      if (this.$refs.scrollContainer) {
        this.$refs.scrollContainer.removeEventListener('scroll', this.onScroll);
      }
      window.removeEventListener('resize', this.updateViewportMetrics);
    }
  },
  methods: {
    toggleHero() {
      this.heroCollapsed = !this.heroCollapsed;

      nextTick(() => {
        this.updateViewportMetrics();
      });
    },
    onScroll() {
      const container = this.$refs.scrollContainer;

      if (!container) {
        return;
      }

      this.scrollTop = container.scrollTop || 0;
      this.updateActiveMessage();
    },
    updateActiveMessage() {
      const layouts = this.messageLayouts;
      if (!layouts || !layouts.length) {
        this.activeMessageId = null;
        return;
      }
      const threadWindowTop = Math.max(this.scrollTop - this.threadViewportTop, 0);
      const targetOffset = threadWindowTop + 80;

      let current = layouts[0].id;
      for (let i = 0; i < layouts.length; i++) {
        const item = layouts[i];
        if (item.offsetTop <= targetOffset) {
          current = item.id;
        } else {
          break;
        }
      }
      this.activeMessageId = current;
    },
    scrollToMessage(messageId) {
      const layout = this.messageLayouts.find((m) => m.id === messageId);
      if (!layout) return;

      const targetScroll = Math.max(0, this.threadViewportTop + layout.offsetTop - 30);

      if (this.$refs.scrollContainer) {
        this.$refs.scrollContainer.scrollTo({
          top: targetScroll,
          behavior: 'smooth'
        });
      }

      this.highlightedMessageId = messageId;
      if (this.highlightTimer) {
        clearTimeout(this.highlightTimer);
      }
      this.highlightTimer = setTimeout(() => {
        this.highlightedMessageId = null;
      }, 2000);
    },
    scrollToTop() {
      if (this.$refs.scrollContainer) {
        this.$refs.scrollContainer.scrollTo({
          top: 0,
          behavior: 'smooth'
        });
      }
    },
    updateViewportMetrics() {
      const container = this.$refs.scrollContainer;

      this.viewportHeight = container ? container.clientHeight || 0 : window.innerHeight || 0;
      this.scrollTop = container ? container.scrollTop || 0 : 0;
      this.updateThreadViewportOffset();
    },
    updateThreadViewportOffset() {
      const viewport = this.$refs.threadViewport;

      if (!viewport) {
        this.threadViewportTop = 0;
        return;
      }

      const container = this.$refs.scrollContainer;
      const rect = viewport.getBoundingClientRect();
      const containerTop = container ? container.getBoundingClientRect().top : 0;
      const containerScrollTop = container ? container.scrollTop || 0 : 0;

      this.threadViewportTop = rect.top - containerTop + containerScrollTop;
    },
    resetVirtualState() {
      this.heightCache = {};
      this.sectionCache = {};
      this.markdownCache = {};
      this.messageElements = {};
      this.pendingHeights = {};
      this.scrollTop = 0;
      this.threadViewportTop = 0;

      if (this.heightFrame) {
        cancelAnimationFrame(this.heightFrame);
        this.heightFrame = null;
      }

      nextTick(() => {
        if (this.$refs.scrollContainer) {
          this.$refs.scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
        }

        this.updateViewportMetrics();
      });
    },
    estimateMessageHeight(message) {
      const isSystem = message.role === 'system';
      const baseHeight = isSystem ? 140 : 110;
      const content = message.systemValue != null
        ? message.systemValue
        : (message.rawMessage?.content || '');
      
      const rawSize = estimateTextSize(content) + estimateTextSize(message.rawMessage?.tool_calls) + estimateTextSize(message.rawMessage?.reasoning_content);
      const estimatedLines = Math.ceil(rawSize / 85);
      
      return Math.min(baseHeight + estimatedLines * 22, 2000);
    },
    setMessageElement(messageId, element) {
      const previousElement = this.messageElements[messageId];

      if (previousElement === element) return;

      if (previousElement && this.messageResizeObserver) {
        this.messageResizeObserver.unobserve(previousElement);
      }

      if (!element) {
        delete this.messageElements[messageId];
        return;
      }

      element.dataset.messageId = messageId;
      this.messageElements[messageId] = element;

      if (this.messageResizeObserver) {
        this.messageResizeObserver.observe(element);
      }
    },
    updateMessageHeight(messageId, nextHeight) {
      const normalizedHeight = Math.ceil(nextHeight);

      if (
        !normalizedHeight || 
        this.heightCache[messageId] === normalizedHeight ||
        this.pendingHeights[messageId] === normalizedHeight
      ) {
        return;
      }

      this.pendingHeights[messageId] = normalizedHeight; 

      if (!this.heightFrame) {
        this.heightFrame = requestAnimationFrame(() => {
          this.heightCache = { ...this.heightCache, ...this.pendingHeights };
          this.pendingHeights = {};
          this.heightFrame = null;
        });
      }
    },
    getMessageSections(message) {
      if (this.sectionCache[message.id]) {
        return this.sectionCache[message.id];
      }

      let sections = [];

      if (message.id === 'system-root') {
        if (typeof message.systemValue === 'string') {
          sections = [createMarkdownSection('system-root-content', message.systemValue)].filter(Boolean);
        } else if (Array.isArray(message.systemValue)) {
          sections = message.systemValue.flatMap((block, index) =>
            normalizeAnthropicBlock(block, `system-root-${index}`)
          );
        }
      } else {
        sections = normalizeMessageSections(message.rawMessage, message.id);
      }

      this.sectionCache[message.id] = sections.filter(Boolean);
      return this.sectionCache[message.id];
    },
    renderMarkdown(section) {
      if (!this.markdownCache[section.id]) {
        this.markdownCache[section.id] = marked.parse(section.content);
      }

      return this.markdownCache[section.id];
    }
  }
};
</script>

<style scoped>
.chat-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background-color: var(--dv-chat-bg);
  background-image: var(--dv-chat-bg-image);
  background-repeat: no-repeat;
}

.chat-scroll {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.chat-backdrop {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--dv-chat-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--dv-chat-grid-line) 1px, transparent 1px);
  background-size: 36px 36px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.28), transparent 1200px);
  pointer-events: none;
}

.chat-shell {
  position: relative;
  z-index: 1;
  max-width: 1180px;
  margin: 0 auto;
  padding: 40px 20px 64px;
  box-sizing: border-box;
}

.chat-hero {
  border: 1px solid var(--dv-chat-hero-border);
  border-radius: 20px;
  background: var(--dv-chat-hero-bg);
  backdrop-filter: blur(14px);
  box-shadow: var(--dv-chat-hero-shadow);
}

.chat-hero-toggle {
  width: 100%;
  display: block;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.chat-hero-summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.chat-hero-summary-main {
  min-width: 0;
}

.chat-hero-eyebrow {
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--dv-chat-hero-eyebrow);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.chat-hero-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.chat-hero-title {
  margin: 0;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--dv-chat-hero-title);
}

.chat-hero :deep(.hero-tag) {
  background: var(--dv-chat-hero-tag-bg);
  color: var(--dv-chat-hero-tag-text);
  border-color: var(--dv-chat-hero-tag-border);
}

.chat-hero-summary-stats {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-hero-summary-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--dv-chat-hero-pill-bg);
  border: 1px solid var(--dv-chat-hero-pill-border);
  color: var(--dv-chat-hero-pill-text);
}

.chat-hero-summary-pill-label {
  font-size: 10px;
  color: var(--dv-chat-hero-pill-label);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.chat-hero-summary-pill strong {
  font-size: 13px;
  line-height: 1;
}

.chat-hero-toggle-indicator {
  font-size: 11px;
  font-weight: 700;
  color: var(--dv-chat-hero-toggle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chat-hero-expanded {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--dv-chat-hero-divider);
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: stretch;
}

.chat-hero-collapsed .chat-hero-toggle {
  padding-bottom: 12px;
}

.chat-hero-copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
}

.chat-hero :deep(.ant-typography) {
  text-align: left;
  margin-bottom: 0;
}

.chat-hero-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 14px 16px;
  max-width: 100%;
  border-radius: 16px;
  background: var(--dv-chat-hero-panel-bg);
  border: 1px solid var(--dv-chat-hero-panel-border);
}

.chat-hero-panel-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--dv-chat-hero-panel-title);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.chat-hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(110px, 1fr));
  gap: 10px;
}

.chat-hero-stat {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--dv-chat-hero-stat-bg);
  border: 1px solid var(--dv-chat-hero-stat-border);
}

.chat-hero-stat-label {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--dv-chat-hero-stat-label);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.chat-hero-stat-value {
  font-size: 15px;
  line-height: 1.3;
  font-weight: 700;
  color: var(--dv-chat-hero-stat-value);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.chat-thread-viewport {
  margin-top: 24px;
  padding: 0 2px;
}

.chat-thread {
  position: relative;
  min-height: 100%;
}

.message-row {
  display: flex;
  position: absolute;
  left: 0;
  width: 100%;
  will-change: transform;
  transition: filter 0.3s ease;
}

.message-row-highlighted .message-card {
  outline: 2px solid var(--dv-button-primary-bg, #2563eb);
  box-shadow: 0 0 20px rgba(37, 99, 235, 0.35);
  animation: pulse-highlight 2s ease-out;
}

@keyframes pulse-highlight {
  0% {
    transform: scale(1.01);
  }
  50% {
    transform: scale(1.005);
  }
  100% {
    transform: scale(1);
  }
}

.message-row-user {
  justify-content: flex-end;
}

.message-row-tool {
  justify-content: flex-end;
}

.message-row-system,
.message-row-assistant {
  justify-content: flex-start;
}

.message-card {
  width: min(860px, 100%);
  border-radius: 16px;
  padding: 12px 16px;
  box-shadow: var(--dv-message-card-shadow);
  border: 1px solid var(--dv-message-card-border);
  text-align: left;
  --message-accent-rgb: 148, 163, 184;
  --message-overlay-start: var(--dv-message-overlay-start);
  --message-overlay-end: var(--dv-message-overlay-end);
  --message-overlay-border: var(--dv-message-overlay-border);
}

.message-card-user {
  background: var(--dv-message-user-bg);
  --message-accent-rgb: 245, 158, 11;
}

.message-card-assistant {
  background: var(--dv-message-assistant-bg);
  --message-accent-rgb: 59, 130, 246;
}

.message-card-system {
  width: 100%;
  background: var(--dv-message-system-bg);
  --message-accent-rgb: 139, 92, 246;
}

.message-card-tool {
  background: var(--dv-message-tool-bg);
  --message-accent-rgb: 13, 148, 136;
}

.message-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.message-author {
  display: flex;
  align-items: center;
  gap: 12px;
}

.message-role {
  font-size: 16px;
  font-weight: 700;
  color: var(--dv-message-role);
}

.message-subtitle {
  font-size: 12px;
  color: var(--dv-message-subtitle);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.message-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.message-sequence-tag {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.message-sections {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-section {
  border-radius: 6px;
  padding: 8px 12px;
}

.message-section-default {
  background: linear-gradient(180deg, var(--message-overlay-start) 0%, var(--message-overlay-end) 100%);
  border: 1px solid var(--message-overlay-border);
  box-shadow: inset 0 1px 0 var(--dv-section-inset-shadow);
  backdrop-filter: blur(2px);
}

.message-section-thinking,
.message-section-tool,
.message-section-tool-result,
.message-section-transcript-code,
.message-section-error {
  border-radius: 6px;
  padding: 8px 12px 0;
  overflow: hidden;
}

.message-section-thinking {
  background: var(--dv-section-thinking-bg);
  border: 1px solid var(--dv-section-thinking-border);
}

.message-card-assistant .message-section-thinking,
.message-card-assistant .message-section-tool {
  background: linear-gradient(180deg, var(--message-overlay-start) 0%, var(--message-overlay-end) 100%);
  border: 1px solid var(--message-overlay-border);
  box-shadow: inset 0 1px 0 var(--dv-section-inset-shadow);
  backdrop-filter: blur(2px);
}

.message-section-tool {
  background: var(--dv-section-tool-bg);
  border: 1px solid var(--dv-section-tool-border);
}

.message-section-tool-result {
  background: var(--dv-section-tool-result-bg);
  border: 1px solid var(--dv-section-tool-result-border);
}

.message-section-transcript-code {
  background: var(--dv-section-transcript-bg);
  border: 1px solid var(--dv-section-transcript-border);
}

.message-section-error {
  background: var(--dv-section-error-bg);
  border: 1px solid var(--dv-section-error-border);
}

/* Remove inner borders/backgrounds for themed sections */
.message-section:not(.message-section-default) .section-code,
.message-section:not(.message-section-default) .section-markdown :deep(pre) {
  background: transparent;
  border: none;
  padding: 0 0 12px 0;
  margin: 0;
  box-shadow: none;
}

.section-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.message-section:not(.message-section-default) .section-heading {
  margin-bottom: 6px;
}

.card-tag {
  margin-inline-end: 0;
  color: rgb(var(--message-accent-rgb));
  background: rgba(var(--message-accent-rgb), 0.1);
  border-color: rgba(var(--message-accent-rgb), 0.24);
  font-weight: 500;
}

.message-section:not(.message-section-default) .card-tag {
  background: rgba(var(--message-accent-rgb), 0.08);
  border-color: rgba(var(--message-accent-rgb), 0.15);
  padding-top: 1px;
  padding-bottom: 1px;
  line-height: 1.4;
  height: auto;
}

.section-meta {
  font-size: 12px;
  color: var(--dv-section-meta-text);
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--dv-section-meta-bg);
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
}

.section-code {
  margin: 0;
  padding: 14px 16px;
  border-radius: 4px;
  background: var(--dv-section-code-bg);
  color: var(--dv-section-code-text);
  border: 1px solid var(--dv-section-code-border);
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.65;
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
}

.section-code::-webkit-scrollbar,
.markdown-content :deep(pre)::-webkit-scrollbar {
  height: 6px;
  background-color: transparent;
}

.section-code::-webkit-scrollbar-track,
.markdown-content :deep(pre)::-webkit-scrollbar-track {
  background-color: var(--dv-scrollbar-track);
  border-radius: 3px;
}

.section-code::-webkit-scrollbar-thumb,
.markdown-content :deep(pre)::-webkit-scrollbar-thumb {
  background-color: var(--dv-scrollbar-thumb);
  border-radius: 3px;
}

.section-code::-webkit-scrollbar-thumb:hover,
.markdown-content :deep(pre)::-webkit-scrollbar-thumb:hover {
  background-color: var(--dv-scrollbar-thumb-hover);
}

.section-markdown {
  color: var(--dv-markdown-text);
  line-height: 1.72;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(pre),
.markdown-content :deep(blockquote) {
  margin: 0 0 8px;
}

.markdown-content :deep(pre) {
  margin-top: 14px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 4px;
  background: var(--dv-markdown-pre-bg);
  color: var(--dv-markdown-pre-text);
  border: 1px solid var(--dv-markdown-pre-border);
  overflow-x: auto;
}

.markdown-content :deep(code) {
  padding: 0.18em 0.42em;
  border-radius: 6px;
  background: var(--dv-markdown-code-bg);
  font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-content :deep(a) {
  color: var(--dv-markdown-link);
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(blockquote) {
  padding: 8px 14px;
  border-left: 3px solid var(--dv-markdown-blockquote-border);
  background: var(--dv-markdown-blockquote-bg);
  color: var(--dv-markdown-blockquote-text);
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 0 0 16px;
  color: var(--dv-markdown-heading);
}

@media (max-width: 768px) {
  .chat-shell {
    padding: 20px 14px 24px;
  }

  .chat-hero {
    border-radius: 18px;
  }

  .chat-hero-toggle {
    padding: 12px;
  }

  .chat-hero-summary {
    flex-direction: column;
    align-items: flex-start;
  }

  .chat-hero-summary-stats {
    justify-content: flex-start;
  }

  .chat-hero-expanded {
    grid-template-columns: 1fr;
  }

  .message-card {
    width: min(100%, calc(100% - 18px));
    padding: 12px 14px;
    border-radius: 14px;
  }

  .chat-thread-viewport {
    padding-bottom: 18px;
  }

  .message-row-user .message-card,
  .message-row-tool .message-card {
    margin-left: 18px;
  }

  .message-row-assistant .message-card,
  .message-row-system .message-card {
    margin-right: 18px;
  }

  .message-header {
    flex-direction: column;
  }

  .message-tags {
    justify-content: flex-start;
  }

  .chat-hero-stats {
    grid-template-columns: 1fr;
  }
}

/* 侧边目录悬浮框样式 */
.chat-toc {
  position: absolute;
  right: 24px;
  bottom: 32px;
  z-index: 99;
}

.chat-toc-bubble {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  background: var(--dv-chat-hero-bg, rgba(255, 255, 255, 0.85));
  backdrop-filter: blur(16px);
  border: 1px solid var(--dv-border, rgba(15, 23, 42, 0.12));
  box-shadow: var(--dv-shadow-strong, 0 12px 32px rgba(0, 0, 0, 0.15));
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--dv-text, #16223b);
}

.chat-toc-bubble:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.2);
}

.chat-toc-bubble-icon {
  font-size: 20px;
}

.chat-toc-bubble-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #1890ff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.3;
  box-shadow: 0 2px 6px rgba(24, 144, 255, 0.4);
}

.chat-toc-panel {
  width: 280px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  background: var(--dv-chat-hero-bg, rgba(255, 255, 255, 0.9));
  backdrop-filter: blur(20px);
  border: 1px solid var(--dv-border, rgba(15, 23, 42, 0.12));
  border-radius: 16px;
  box-shadow: var(--dv-shadow-strong, 0 16px 40px rgba(0, 0, 0, 0.16));
  overflow: hidden;
  animation: toc-slide-in 0.2s ease-out;
}

@keyframes toc-slide-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.chat-toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--dv-border-soft, rgba(148, 163, 184, 0.2));
  background: rgba(var(--message-accent-rgb, 148, 163, 184), 0.05);
}

.chat-toc-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--dv-text, #16223b);
}

.chat-toc-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-toc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--dv-text-muted, #667085);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 13px;
}

.chat-toc-btn:hover {
  background: rgba(148, 163, 184, 0.2);
  color: var(--dv-text, #16223b);
}

.chat-toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-toc-list::-webkit-scrollbar {
  width: 4px;
}
.chat-toc-list::-webkit-scrollbar-thumb {
  background: var(--dv-scrollbar-thumb, rgba(15, 23, 42, 0.15));
  border-radius: 2px;
}

.chat-toc-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.15s ease;
}

html.dark .chat-toc-item {
  background: rgba(15, 23, 42, 0.5);
}

.chat-toc-item:hover {
  background: rgba(var(--message-accent-rgb, 148, 163, 184), 0.12);
  border-color: rgba(var(--message-accent-rgb, 148, 163, 184), 0.25);
  transform: translateX(-2px);
}

.chat-toc-item-active {
  background: rgba(37, 99, 235, 0.12) !important;
  border-color: rgba(37, 99, 235, 0.4) !important;
}

.chat-toc-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chat-toc-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.2;
}

.chat-toc-badge-user {
  background: rgba(245, 158, 11, 0.18);
  color: #d97706;
}

.chat-toc-badge-assistant {
  background: rgba(59, 130, 246, 0.18);
  color: #2563eb;
}

.chat-toc-badge-system {
  background: rgba(139, 92, 246, 0.18);
  color: #7c3aed;
}

.chat-toc-badge-tool {
  background: rgba(13, 148, 136, 0.18);
  color: #0f766e;
}

.chat-toc-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--dv-text-subtle, #475569);
}

.chat-toc-snippet {
  font-size: 11px;
  line-height: 1.35;
  color: var(--dv-text-muted, #667085);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .chat-toc {
    right: 12px;
    bottom: 20px;
  }
  .chat-toc-panel {
    width: calc(100vw - 32px);
    max-width: 320px;
  }
}
</style>
