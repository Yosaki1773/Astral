/**
 * Vitest 全局初始化
 *
 * jsdom 未实现部分浏览器 API，而组件依赖它们，这里做最小补齐。
 */

// ResizeObserver：LlmChat 用它测量消息高度与视口尺寸
if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
        observe(): void {}

        unobserve(): void {}

        disconnect(): void {}
    }

    (globalThis as any).ResizeObserver = ResizeObserverStub;
}

// Element.prototype.scrollTo：LlmChat 的虚拟滚动会调用它
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo(): void {};
}

// window.matchMedia：主题相关逻辑会用到
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    (window as any).matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}
