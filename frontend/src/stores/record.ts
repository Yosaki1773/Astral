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

    // Getters
    const hasRecords = computed(() => records.value.length > 0);

    // Actions
    async function fetchRecords(query?: RecordQuery): Promise<{ total: number }> {
        loading.value = true;
        try {
            const response = await listRecords(query);
            const fetchedRecords = response.list || [];
            total.value = response.total || 0;

            // 先渲染列表再异步补全名称：避免表格等名称请求全部完成才显示数据
            records.value = fetchedRecords;
            if (fetchedRecords.length > 0) {
                void enrichRecords(fetchedRecords);
            }

            return { total: total.value };
        } catch (error) {
            console.error('获取记录列表失败:', error);
            records.value = [];
            total.value = 0;
            return { total: 0 };
        } finally {
            loading.value = false;
        }
    }

    async function fetchLatest(limit: number = 10): Promise<void> {
        loading.value = true;
        try {
            const response = await latestRecords(limit);
            const fetchedRecords = response || [];

            records.value = fetchedRecords;
            if (fetchedRecords.length > 0) {
                void enrichRecords(fetchedRecords);
            }
        } catch (error) {
            console.error('获取最新记录失败:', error);
            records.value = [];
        } finally {
            loading.value = false;
        }
    }

    /**
     * 为记录列表填充关联名称（用户、模型、供应商）。
     * 名称数据优先取全局 directory 缓存（TTL 内零请求），仅对缓存中缺失的
     * id 才退回 batch 接口逐批补全；补全结果直接写到传入的记录对象上，
     * 响应式更新表格，不阻塞列表渲染。
     */
    async function enrichRecords(recordList: Record[]) {
        const directory = useDirectoryStore();

        const [users, models] = await Promise.all([
            directory.loadUsers(),
            directory.loadModels(),
        ]);

        const userMap = new Map(users.map(u => [Number(u.id), u.name]));
        const modelMap = new Map(models.map(m => [Number(m.id), m]));

        recordList.forEach(record => {
            const uid = record.user_id !== null ? Number(record.user_id) : null;
            const mid = record.model_id !== null ? Number(record.model_id) : null;

            if (uid === -1) {
                record.user_name = 'root';
            } else if (uid) {
                record.user_name = userMap.get(uid) || `用户${uid}`;
            }

            if (mid) {
                const model = modelMap.get(mid);
                if (model) {
                    record.model_name = model.name;
                } else {
                    record.model_name = `模型${mid}`;
                }
            }

            if (record.vendor_id) {
                // vendor_id 为空时大多数记录不涉及上游，按需加载避免每次进页面都拉供应商列表
                void loadVendorName(record);
            } else {
                record.vendor_name = null;
            }

            // vendor_model_name 已经由后端直接返回，不需要单独再映射
        });
    }

    /** 单条记录的供应商名称补全：directory 缓存优先，缓存命中则零请求 */
    async function loadVendorName(record: Record) {
        const directory = useDirectoryStore();
        const vendors = await directory.loadVendors();
        const vendor = vendors.find(v => Number(v.id) === Number(record.vendor_id));
        record.vendor_name = vendor ? vendor.name : `供应商${record.vendor_id}`;
    }

    async function fetchRecordDetail(id: number): Promise<void> {
        loading.value = true;
        currentRecord.value = null;
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
        } finally {
            loading.value = false;
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
        hasRecords,
        fetchRecords,
        fetchLatest,
        enrichRecords,
        fetchRecordDetail,
        clearCurrentRecord,
        clearRecords,
    };
});
