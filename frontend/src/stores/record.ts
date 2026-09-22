import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { listRecords, latestRecords, getRecord, getRecordActivity } from '@/api/record';
import { getUser } from '@/api/user';
import { getModel } from '@/api/model';
import { getVendor } from '@/api/vendor';
import { useDirectoryStore } from '@/stores/directory';
import type { Record, RecordQuery, RecordDetail, RecordActivityEntry } from '@/types/record';


export const useRecordStore = defineStore('record', () => {
    // State
    const records = ref<Record[]>([]);
    const currentRecord = ref<RecordDetail | null>(null);
    const activities = ref<RecordActivityEntry[]>([]);
    const total = ref(0);
    const loading = ref(false);
    /** 详情请求 404（记录确实不存在）才为 true；加载中 / 网络错误不算 */
    const recordNotFound = ref(false);
    /** 详情请求失败（非 404，如网络错误/500）：避免骨架屏无限停留 */
    const recordLoadFailed = ref(false);

    // 延迟显示加载状态：列表请求通常亚秒级返回，loading 立即置 true 会让
    // 5 秒自动刷新时表格反复闪 spinner。仅当请求超过阈值仍未返回才显示。
    const LOADING_DELAY_MS = 3000;
    let pendingFetchCount = 0;
    let loadingTimer: number | null = null;

    function beginLoading(): void {
        pendingFetchCount++;
        if (loadingTimer === null) {
            loadingTimer = window.setTimeout(() => {
                loadingTimer = null;
                if (pendingFetchCount > 0) {
                    loading.value = true;
                }
            }, LOADING_DELAY_MS);
        }
    }

    function endLoading(): void {
        pendingFetchCount = Math.max(0, pendingFetchCount - 1);
        // 全部在途请求结束才撤销：延迟期间可能已有新请求接力
        if (pendingFetchCount === 0) {
            if (loadingTimer !== null) {
                clearTimeout(loadingTimer);
                loadingTimer = null;
            }
            loading.value = false;
        }
    }

    // 名称补全是异步的，而列表会被下一次刷新整体替换。用版本号标记
    // "当前列表代次"：补全完成时若列表已被替换（代次不符），丢弃结果，
    // 避免向旧数组写名称（写了也看不见，新数组反而没人补全）。
    let listGeneration = 0;

    // Getters
    const hasRecords = computed(() => records.value.length > 0);

    // Actions
    async function fetchRecords(query?: RecordQuery): Promise<{ total: number }> {
        beginLoading();
        try {
            const response = await listRecords(query);
            const fetchedRecords = response.list || [];
            total.value = response.total || 0;

            // 先渲染列表再异步补全名称：避免表格等名称请求全部完成才显示数据
            const generation = ++listGeneration;
            records.value = fetchedRecords;
            if (fetchedRecords.length > 0) {
                void enrichRecords(fetchedRecords, generation);
            }

            return { total: total.value };
        } catch (error) {
            console.error('获取记录列表失败:', error);
            const generation = ++listGeneration;
            records.value = [];
            total.value = 0;
            void enrichRecords(records.value, generation);
            return { total: 0 };
        } finally {
            endLoading();
        }
    }

    async function fetchLatest(limit: number = 10): Promise<void> {
        beginLoading();
        try {
            const response = await latestRecords(limit);
            const fetchedRecords = response || [];

            const generation = ++listGeneration;
            records.value = fetchedRecords;
            if (fetchedRecords.length > 0) {
                void enrichRecords(fetchedRecords, generation);
            }
        } catch (error) {
            console.error('获取最新记录失败:', error);
            const generation = ++listGeneration;
            records.value = [];
            void enrichRecords(records.value, generation);
        } finally {
            endLoading();
        }
    }

    /**
     * 为记录列表填充关联名称（用户、模型、供应商）。
     * 名称数据优先取全局 directory 缓存（TTL 内零请求）；补全不阻塞列表渲染，
     * 完成后写回记录对象，响应式更新表格。
     *
     * 传 generation（列表页路径）时：等待期间若列表被下一次刷新整体替换
     * （代次不符），直接放弃，由替换时启动的补全任务负责新列表；且必须通过
     * records.value 的响应式代理写入——直接改原始对象不会触发视图更新。
     * 不传 generation（仪表盘等外部调用）时：保持旧行为，直接改传入数组，
     * 调用方在 await 之后才把数组赋给自己的响应式状态。
     */
    async function enrichRecords(recordList: Record[], generation?: number) {
        const directory = useDirectoryStore();

        try {
            const [users, models, vendors] = await Promise.all([
                directory.loadUsers(),
                directory.loadModels(),
                directory.loadVendors(),
            ]);

            if (generation !== undefined && generation !== listGeneration) {
                return;
            }

            const userMap = new Map(users.map(u => [Number(u.id), u.name]));
            const modelMap = new Map(models.map(m => [Number(m.id), m]));
            const vendorMap = new Map(vendors.map(v => [Number(v.id), v.name]));

            // 列表页路径：通过 records.value 代理写入以触发响应式；
            // 长度不一致说明中间被 clearRecords 等操作动过，放弃本次写入
            const target = generation !== undefined
                ? (records.value.length === recordList.length ? records.value : null)
                : null;
            const list = target ?? recordList;

            list.forEach(record => {
                const uid = record.user_id !== null ? Number(record.user_id) : null;
                const mid = record.model_id !== null ? Number(record.model_id) : null;
                const vid = record.vendor_id !== null && record.vendor_id !== undefined
                    ? Number(record.vendor_id)
                    : null;

                if (uid === -1) {
                    record.user_name = 'root';
                } else if (uid) {
                    record.user_name = userMap.get(uid) || `用户${uid}`;
                }

                if (mid) {
                    const model = modelMap.get(mid);
                    record.model_name = model ? model.name : `模型${mid}`;
                }

                record.vendor_name = vid !== null
                    ? (vendorMap.get(vid) || `供应商${vid}`)
                    : null;

                // vendor_model_name 已经由后端直接返回，不需要单独再映射
            });
        } catch (error) {
            console.error('补全记录名称失败:', error);
        }
    }

    async function fetchRecordDetail(id: number): Promise<void> {
        beginLoading();
        currentRecord.value = null;
        recordNotFound.value = false;
        recordLoadFailed.value = false;
        activities.value = [];
        try {
            const record = await getRecord(id);

            // 准备详情数据
            const recordDetail: RecordDetail = {
                ...record,
                user_name: null,
                model_name: null,
                vendor_name: null,
            };

            // 并行查询用户和模型信息
            const promises: Promise<void>[] = [];

            if (record.user_id === -1) {
                recordDetail.user_name = 'root';
            } else if (record.user_id) {
                promises.push(
                    getUser(record.user_id).then(user => {
                        recordDetail.user_name = user.name;
                    }).catch(() => {
                        recordDetail.user_name = `用户${record.user_id}`;
                    })
                );
            }

            if (record.model_id) {
                promises.push(
                    getModel(record.model_id).then(async model => {
                        recordDetail.model_name = model.name;
                    }).catch(() => {
                        recordDetail.model_name = `模型${record.model_id}`;
                    })
                );
            }

            if (record.vendor_id) {
                promises.push(
                    getVendor(record.vendor_id).then(vendor => {
                        recordDetail.vendor_name = vendor.name;
                    }).catch(() => {
                        recordDetail.vendor_name = `供应商${record.vendor_id}`;
                    })
                );
            }

            // 请求活动日志（时间线）：best-effort，失败不影响详情展示
            promises.push(
                getRecordActivity(id).then(res => {
                    activities.value = res.activities || [];
                }).catch(() => {
                    activities.value = [];
                })
            );

            await Promise.all(promises);
            currentRecord.value = recordDetail;
        } catch (error) {
            console.error('获取记录详情失败:', error);
            currentRecord.value = null;
            // 仅 404 视为"确实不存在"；其余错误归入加载失败，避免骨架屏无限停留
            recordNotFound.value = (error as { status?: number })?.status === 404;
            recordLoadFailed.value = !recordNotFound.value;
        } finally {
            endLoading();
        }
    }

    function clearCurrentRecord(): void {
        currentRecord.value = null;
        activities.value = [];
    }

    function clearRecords(): void {
        records.value = [];
        total.value = 0;
    }

    return {
        records,
        currentRecord,
        activities,
        total,
        loading,
        recordNotFound,
        recordLoadFailed,
        hasRecords,
        fetchRecords,
        fetchLatest,
        enrichRecords,
        fetchRecordDetail,
        clearCurrentRecord,
        clearRecords,
    };
});
