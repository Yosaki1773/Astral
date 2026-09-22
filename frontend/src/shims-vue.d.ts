/**
 * 兜底声明：为未生成类型声明的 .vue 单文件组件提供模块声明。
 *
 * 项目绝大多数 .vue 组件使用 `<script setup lang="ts">`，会被 vue-tsc 正常解析并做类型检查；
 * 该声明只在此类真实解析失败时生效（例如 dataViewer 目录下由原独立子项目迁移而来、
 * 仍保持 Options API + 纯 JS 的组件）。
 */
declare module '*.vue' {
    import type { DefineComponent } from 'vue';

    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}
