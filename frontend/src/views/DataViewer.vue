<template>
    <div class="standalone-viewer">
        <DataViewer :data="data" :data-type="dataType" />
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import DataViewer from '@/components/dataViewer/DataViewer.vue';

/**
 * 独立整页可视化视图
 *
 * 原实现在独立 data_viewer 项目中通过 URL 上的 session_key 从 localStorage 读取对话数据，
 * 现改为前端路由承载，数据来源保持不变。
 */
const route = useRoute();

const data = ref<any>(null);
const dataType = ref<string | null>(null);

onMounted(() => {
    const sessionKey = route.query.session_key;
    if (typeof sessionKey !== 'string' || !sessionKey) {
        return;
    }

    const raw = localStorage.getItem(sessionKey);
    if (!raw) {
        return;
    }

    try {
        data.value = JSON.parse(raw);
        dataType.value = 'llm';
    } catch (error) {
        console.warn('Failed to load session data:', error);
    } finally {
        localStorage.removeItem(sessionKey);
    }
});
</script>

<style scoped>
.standalone-viewer {
    width: 100%;
    height: 100vh;
    overflow: hidden;
}
</style>
