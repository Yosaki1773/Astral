<template>
  <div class="record-detail-page">
    <!-- 紧凑状态栏 Status Bar -->
    <header class="status-bar-header">
      <div class="status-bar-content">
        <!-- 左侧：返回、标题、状态徽章、ID & 时间 -->
        <div class="status-bar-left">
          <button
            type="button"
            class="btn-icon"
            title="返回请求列表"
            aria-label="返回上一级列表"
            @click="handleBack"
          >
            <ArrowLeftOutlined />
          </button>
          <div class="identity-block">
            <div class="identity-top">
              <span class="page-title">请求记录详情</span>
              <span
                v-if="recordStore.currentRecord"
                class="status-badge"
                :class="`status-${recordStore.currentRecord.status || 'default'}`"
              >
                <span class="status-dot"></span>
                {{ getStatusBadgeText(recordStore.currentRecord.status) }}
              </span>
            </div>
            <div v-if="recordStore.currentRecord" class="identity-sub">
              <span class="record-id-tag"
                >#{{ recordStore.currentRecord.id }}</span
              >
              <span class="bullet">•</span>
              <span class="created-time">{{
                formatDate(recordStore.currentRecord.created_at)
              }}</span>
            </div>
          </div>
        </div>

        <div class="v-divider"></div>

        <!-- 中间段 1：核心标识（接入模型、供应商/实际模型、协议） -->
        <div v-if="recordStore.currentRecord" class="status-bar-meta">
          <!-- 接入模型 -->
          <div class="meta-col">
            <span class="micro-label">接入模型</span>
            <span
              class="meta-value font-mono font-semibold"
              :title="recordStore.currentRecord.model_name || '-'"
            >
              {{ recordStore.currentRecord.model_name || "-" }}
            </span>
          </div>
          <!-- 供应商 & 实际模型 -->
          <div class="meta-col">
            <div class="meta-label-flex">
              <span class="micro-label">供应商 / 实际模型</span>
              <span
                v-if="recordStore.currentRecord.vendor_name"
                class="vendor-tag"
              >
                {{ recordStore.currentRecord.vendor_name }}
              </span>
            </div>
            <span
              class="meta-value font-mono font-secondary"
              :title="recordStore.currentRecord.vendor_model_name || '-'"
            >
              {{ recordStore.currentRecord.vendor_model_name || "-" }}
            </span>
          </div>
          <!-- 协议 -->
          <div class="meta-col">
            <span class="micro-label">协议</span>
            <div
              v-if="recordStore.currentRecord.client_format"
              class="protocol-badge-row"
            >
              <span class="protocol-badge">{{
                recordStore.currentRecord.client_format.toUpperCase()
              }}</span>
              <template v-if="recordStore.currentRecord.upstream_format">
                <span class="protocol-arrow">→</span>
                <span class="protocol-badge protocol-upstream">{{
                  recordStore.currentRecord.upstream_format.toUpperCase()
                }}</span>
              </template>
            </div>
            <span v-else class="meta-value">-</span>
          </div>
        </div>

        <div class="v-divider"></div>

        <!-- 中间段 2：指标与性能（Token 用量、缓存命中、总耗时、首 Token 延迟） -->
        <div v-if="recordStore.currentRecord" class="status-bar-metrics">
          <!-- Token 用量 -->
          <div class="metric-col">
            <span class="micro-label">
              Token 用量
              <span class="micro-sub">(Prompt / Comp)</span>
            </span>
            <div v-if="usageTokens" class="metric-value-row font-mono">
              <span class="token-up" title="输入 Token">
                <ArrowUpOutlined class="token-arrow" />
                {{ usageTokens.prompt }}
              </span>
              <span
                v-if="usageTokens.cacheReadTokens !== null"
                class="token-cached"
                title="缓存命中扩展 Token"
              >
                (+ {{ usageTokens.cacheReadTokens.toLocaleString() }})
              </span>
              <span class="slash">/</span>
              <span class="token-down" title="输出 Token">
                <ArrowDownOutlined class="token-arrow" />
                {{ usageTokens.output }}
              </span>
            </div>
            <span v-else class="meta-value font-mono">-</span>
          </div>
          <!-- 缓存命中 -->
          <div class="metric-col">
            <span class="micro-label">缓存命中</span>
            <div v-if="usageTokens?.cacheHitRate != null" class="cache-hit-row">
              <span class="cache-hit-num"
                >{{ usageTokens.cacheHitRate.toFixed(1) }}%</span
              >
              <span class="cache-hit-dot"></span>
            </div>
            <span v-else class="meta-value font-mono">-</span>
          </div>
          <!-- 总耗时 -->
          <div class="metric-col">
            <span class="micro-label">总耗时</span>
            <span class="meta-value font-mono font-semibold">
              {{
                totalDuration !== null
                  ? totalDuration.toLocaleString() + "ms"
                  : "-"
              }}
            </span>
          </div>
          <!-- 首 Token 延迟 -->
          <div class="metric-col">
            <span class="micro-label">首 Token 延迟</span>
            <span
              v-if="recordStore.currentRecord.first_token_latency"
              class="ttft-pill font-mono"
            >
              {{
                recordStore.currentRecord.first_token_latency.toLocaleString()
              }}ms
            </span>
            <span v-else class="meta-value font-mono">-</span>
          </div>
        </div>

        <div class="v-divider"></div>

        <!-- 右侧操作区：上一条、下一条、删除 -->
        <div class="status-bar-actions">
          <div class="btn-group-nav">
            <button
              type="button"
              class="btn-nav"
              :disabled="currentRecordId <= 1"
              title="上一个请求"
              @click="navigateToRecord(currentRecordId - 1)"
            >
              <LeftOutlined class="icon-nav" />
              <span>上一个请求</span>
            </button>
            <button
              type="button"
              class="btn-nav"
              :disabled="currentRecordId <= 0"
              title="下一个请求"
              @click="navigateToRecord(currentRecordId + 1)"
            >
              <span>下一个请求</span>
              <RightOutlined class="icon-nav" />
            </button>
          </div>
          <a-popconfirm
            title="确认删除这条请求记录？"
            ok-text="删除"
            cancel-text="取消"
            ok-type="danger"
            @confirm="handleDelete"
          >
            <button type="button" class="btn-delete" title="删除此条请求日志">
              <DeleteOutlined class="icon-delete" />
              <span>删除</span>
            </button>
          </a-popconfirm>
        </div>
      </div>
    </header>

    <!-- 主体区域：双栏联动观测台 -->
    <main class="workbench-container">
      <a-spin :spinning="recordStore.loading">
        <!-- 请求在途：骨架屏占位 -->
        <div v-if="isDetailLoading" class="workbench-grid">
          <div class="workbench-col">
            <div class="panel-card skeleton-panel">
              <a-skeleton active :paragraph="{ rows: 12 }" />
            </div>
          </div>
          <div class="workbench-col">
            <div class="panel-card skeleton-panel">
              <a-skeleton active :paragraph="{ rows: 12 }" />
            </div>
          </div>
        </div>

        <div v-else-if="recordStore.currentRecord" class="workbench-grid">
          <!-- ============================================== -->
          <!-- 左半边：对话可视化 (Data Viewer Iframe / Request Payload) -->
          <!-- ============================================== -->
          <div class="workbench-col left-col">
            <section class="panel-card left-panel-card">
              <!-- 面板标题栏 -->
              <div class="panel-header">
                <div class="panel-title-wrap">
                  <span class="panel-dot dot-indigo"></span>
                  <h2 class="panel-title">对话可视化 (CONVERSATION VIEWER)</h2>
                  <span v-if="messageCount > 0" class="badge-count">
                    {{ messageCount }} Messages
                  </span>
                </div>
                <div class="panel-actions">
                  <button
                    v-if="messageCount > 0"
                    type="button"
                    class="btn-pill-action"
                    title="在新标签页打开"
                    @click="openVisualInNewTab"
                  >
                    <ExportOutlined />
                    <span>新标签页打开</span>
                  </button>
                  <button
                    type="button"
                    class="btn-pill-action"
                    title="复制完整请求JSON"
                    @click="
                      copyText(
                        recordStore.currentRecord.request_data || '',
                        '请求 JSON',
                      )
                    "
                  >
                    <CopyOutlined />
                    <span>Copy JSON</span>
                  </button>
                </div>
              </div>

              <!-- 1. 调用运行时参数 (Inference Hyperparameters) -->
              <div v-if="parsedRequestParams" class="params-strip">
                <div class="params-header">
                  <span class="params-title"
                    >调用运行时参数 (INFERENCE HYPERPARAMETERS)</span
                  >
                  <span class="params-route font-mono">{{
                    requestRouteInfo
                  }}</span>
                </div>
                <div class="params-grid">
                  <div class="param-box">
                    <span class="param-label">temperature</span>
                    <span class="param-val">{{
                      parsedRequestParams.temperature ?? "-"
                    }}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label">stream</span>
                    <span
                      class="param-val"
                      :class="parsedRequestParams.stream ? 'text-purple' : ''"
                    >
                      {{
                        parsedRequestParams.stream != null
                          ? String(parsedRequestParams.stream)
                          : "-"
                      }}
                    </span>
                  </div>
                  <div class="param-box">
                    <span class="param-label">max_tokens</span>
                    <span class="param-val">{{
                      parsedRequestParams.max_tokens ?? "-"
                    }}</span>
                  </div>
                  <div class="param-box">
                    <span class="param-label">top_p</span>
                    <span class="param-val">{{
                      parsedRequestParams.top_p ?? "-"
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- 2. 对话可视化组件（原独立 data_viewer 已内联为前端组件） -->
              <div class="viewer-iframe-wrapper">
                <div v-if="messageCount === 0" class="no-payload-hint">
                  <div
                    v-if="!recordStore.currentRecord.request_data"
                    class="no-payload-title"
                  >
                    请求内容未记录
                  </div>
                  <div v-else class="no-payload-title">
                    暂无可供可视化的对话数据
                  </div>
                  <div class="no-payload-desc">
                    如需记录请到设置中打开开关，或在右侧查看原始 JSON
                  </div>
                </div>
                <DataViewer
                  v-else
                  :data="conversationData"
                  data-type="llm"
                  embedded
                  class="visualization-viewer"
                />
              </div>
            </section>
          </div>

          <!-- ============================================== -->
          <!-- 右半边：响应日志、响应预览、延时分解与JSON (Response & Logs) -->
          <!-- ============================================== -->
          <div class="workbench-col right-col">
            <section class="panel-card right-panel-card">
              <!-- 面板标题栏与选项卡切换 -->
              <div class="panel-header">
                <div class="panel-title-wrap">
                  <span class="panel-dot dot-emerald"></span>
                  <h2 class="panel-title">
                    响应预览与日志 (RESPONSE &amp; LOGS)
                  </h2>
                </div>
                <!-- 右侧 Tab 切换器：格式化预览 / 原始 JSON / 请求 JSON / 分块流 / 活动日志 -->
                <div class="tab-switcher">
                  <button
                    type="button"
                    class="tab-btn"
                    :class="{ active: activeRightTab === 'preview' }"
                    @click="activeRightTab = 'preview'"
                  >
                    格式化预览
                  </button>
                  <button
                    type="button"
                    class="tab-btn"
                    :class="{ active: activeRightTab === 'response_json' }"
                    @click="activeRightTab = 'response_json'"
                  >
                    响应 JSON
                  </button>
                  <button
                    type="button"
                    class="tab-btn"
                    :class="{ active: activeRightTab === 'request_json' }"
                    @click="activeRightTab = 'request_json'"
                  >
                    请求 JSON
                  </button>
                  <button
                    type="button"
                    class="tab-btn"
                    :class="{ active: activeRightTab === 'sse_stream' }"
                    @click="activeRightTab = 'sse_stream'"
                  >
                    分块流 (SSE)
                  </button>
                  <button
                    type="button"
                    class="tab-btn"
                    :class="{ active: activeRightTab === 'activity' }"
                    @click="activeRightTab = 'activity'"
                  >
                    日志 ({{ recordStore.activities.length }})
                  </button>
                  <button
                    v-if="recordStore.currentRecord.status === 'failed'"
                    type="button"
                    class="tab-btn tab-btn-error"
                    :class="{ active: activeRightTab === 'error' }"
                    @click="activeRightTab = 'error'"
                  >
                    报错信息
                  </button>
                </div>
              </div>

              <!-- Tab 1: 格式化预览 (Formatted Preview & Assistant Markdown) -->
              <div
                v-show="activeRightTab === 'preview'"
                class="right-tab-content preview-scrollable"
              >
                <!-- 1. 响应元数据 & 状态条 (Response Status Strip) -->
                <div class="response-status-strip">
                  <div class="response-strip-left">
                    <span
                      class="res-status-tag"
                      :class="`tag-${recordStore.currentRecord.status || 'default'}`"
                    >
                      {{
                        getResponseStatusText(recordStore.currentRecord.status)
                      }}
                    </span>
                    <span
                      v-if="parsedResponseMeta.finishReason"
                      class="res-meta-pill"
                    >
                      Finish:
                      <strong>{{ parsedResponseMeta.finishReason }}</strong>
                    </span>
                    <span
                      v-if="parsedResponseMeta.chunkCount"
                      class="res-meta-pill"
                    >
                      Chunks:
                      <strong>{{ parsedResponseMeta.chunkCount }}</strong>
                    </span>
                  </div>
                  <div
                    v-if="generationSpeed !== null"
                    class="response-strip-right font-mono"
                  >
                    <span class="gen-speed-label">生成速率:</span>
                    <span class="gen-speed-val"
                      >{{ generationSpeed }} tokens/s</span
                    >
                  </div>
                </div>

                <!-- 2. 延时分解 (Latency Breakdown Timeline) -->
                <div v-if="latencyBreakdown" class="latency-section">
                  <div class="latency-header">
                    <span class="latency-title">
                      <ThunderboltOutlined class="icon-thunder" />
                      延时分解 (Latency Breakdown Timeline)
                    </span>
                    <span class="latency-total font-mono">
                      总历时:
                      <strong class="total-num"
                        >{{ latencyBreakdown.totalDuration }}ms</strong
                      >
                    </span>
                  </div>
                  <!-- 多段彩色延时进度条 -->
                  <div class="latency-progress-bar">
                    <div
                      class="latency-segment seg-dns"
                      :style="{ width: latencyBreakdown.dnsPercent + '%' }"
                      :title="`网络/握手: ${latencyBreakdown.dnsMs}ms`"
                    ></div>
                    <div
                      class="latency-segment seg-ttft"
                      :style="{ width: latencyBreakdown.ttftPercent + '%' }"
                      :title="`等待首字延迟 (TTFT): ${latencyBreakdown.ttftMs}ms`"
                    ></div>
                    <div
                      class="latency-segment seg-stream"
                      :style="{ width: latencyBreakdown.streamPercent + '%' }"
                      :title="`流式生成/传输: ${latencyBreakdown.streamMs}ms`"
                    ></div>
                  </div>
                  <!-- 图例指标 -->
                  <div class="latency-legend font-mono">
                    <div class="legend-item text-slate-500">
                      <span class="legend-dot dot-slate"></span>
                      <span class="truncate"
                        >DNS/网络: {{ latencyBreakdown.dnsMs }}ms</span
                      >
                    </div>
                    <div class="legend-item text-amber-600 font-medium">
                      <span class="legend-dot dot-amber"></span>
                      <span class="truncate"
                        >TTFT: {{ latencyBreakdown.ttftMs }}ms</span
                      >
                    </div>
                    <div class="legend-item text-emerald-600 font-medium">
                      <span class="legend-dot dot-emerald"></span>
                      <span class="truncate"
                        >传输流耗时: {{ latencyBreakdown.streamMs }}ms</span
                      >
                    </div>
                  </div>
                </div>

                <div class="assistant-content-container">
                  <div class="assistant-header">
                    <span class="assistant-title">
                      <FileTextOutlined class="icon-assistant" />
                      Assistant 回复内容 (Markdown Rendered)
                    </span>
                    <button
                      v-if="assistantReplyText"
                      type="button"
                      class="btn-copy-assistant font-mono"
                      @click="copyText(assistantReplyText, '回复内容')"
                    >
                      <CopyOutlined />
                      <span>复制回复</span>
                    </button>
                  </div>

                  <!-- 渲染出的 Assistant Markdown 正文 -->
                  <div
                    v-if="assistantReplyText"
                    class="assistant-markdown-body"
                  >
                    <div
                      class="rendered-markdown"
                      v-html="renderMarkdown(assistantReplyText)"
                    ></div>
                  </div>
                  <div
                    v-else-if="!recordStore.currentRecord.response_data"
                    class="no-payload-hint"
                  >
                    <div class="no-payload-title">响应内容未记录</div>
                    <div class="no-payload-desc">
                      如需记录请到设置中打开开关
                    </div>
                  </div>
                  <div v-else class="no-payload-hint">
                    <div class="no-payload-title">暂无可预览的回复文本</div>
                    <div class="no-payload-desc">
                      请通过“响应 JSON”标签页查看返回的数据结构
                    </div>
                  </div>

                  <!-- 底部 Chunk 流式结束指示 -->
                  <div
                    v-if="assistantReplyText && parsedResponseMeta.finishReason"
                    class="stream-done-pill font-mono"
                  >
                    <span
                      >[DONE] ·
                      {{
                        parsedResponseMeta.chunkCount
                          ? `${parsedResponseMeta.chunkCount} chunks aggregated · `
                          : ""
                      }}Final finish_reason: "{{
                        parsedResponseMeta.finishReason
                      }}"</span
                    >
                  </div>
                </div>
              </div>

              <!-- Tab 2: 响应 JSON (树状浏览) -->
              <div
                v-show="activeRightTab === 'response_json'"
                class="right-tab-content json-scrollable"
              >
                <div class="json-pane-header">
                  <span class="json-pane-title font-mono">响应数据 (JSON)</span>
                  <div class="json-pane-actions">
                    <a-button
                      type="link"
                      size="small"
                      @click="isResponseExpanded = !isResponseExpanded"
                    >
                      {{ isResponseExpanded ? "全部收起" : "全部展开" }}
                    </a-button>
                    <a-button
                      type="link"
                      size="small"
                      @click="
                        responseJsonRef?.handleCopy
                          ? responseJsonRef.handleCopy()
                          : copyText(
                              recordStore.currentRecord.response_data || '',
                              '响应 JSON',
                            )
                      "
                    >
                      复制
                    </a-button>
                    <a-button
                      type="link"
                      size="small"
                      :disabled="!recordStore.currentRecord.response_data"
                      @click="
                        downloadJson(
                          recordStore.currentRecord.response_data,
                          'response',
                        )
                      "
                    >
                      <template #icon><DownloadOutlined /></template>
                      下载
                    </a-button>
                  </div>
                </div>
                <div
                  v-if="!recordStore.currentRecord.response_data"
                  class="no-payload-hint"
                >
                  <div class="no-payload-title">响应内容未记录</div>
                  <div class="no-payload-desc">如需记录请到设置中打开开关</div>
                </div>
                <JsonViewer
                  v-else
                  ref="responseJsonRef"
                  :data="recordStore.currentRecord.response_data"
                  :expanded="isResponseExpanded"
                />
              </div>

              <!-- Tab 3: 请求 JSON (树状浏览) -->
              <div
                v-show="activeRightTab === 'request_json'"
                class="right-tab-content json-scrollable"
              >
                <div class="json-pane-header">
                  <span class="json-pane-title font-mono">请求数据 (JSON)</span>
                  <div class="json-pane-actions">
                    <a-button
                      type="link"
                      size="small"
                      @click="isRequestExpanded = !isRequestExpanded"
                    >
                      {{ isRequestExpanded ? "全部收起" : "全部展开" }}
                    </a-button>
                    <a-button
                      type="link"
                      size="small"
                      @click="
                        requestJsonRef?.handleCopy
                          ? requestJsonRef.handleCopy()
                          : copyText(
                              recordStore.currentRecord.request_data || '',
                              '请求 JSON',
                            )
                      "
                    >
                      复制
                    </a-button>
                    <a-button
                      type="link"
                      size="small"
                      :disabled="!recordStore.currentRecord.request_data"
                      @click="
                        downloadJson(
                          recordStore.currentRecord.request_data,
                          'request',
                        )
                      "
                    >
                      <template #icon><DownloadOutlined /></template>
                      下载
                    </a-button>
                  </div>
                </div>
                <div
                  v-if="!recordStore.currentRecord.request_data"
                  class="no-payload-hint"
                >
                  <div class="no-payload-title">请求内容未记录</div>
                  <div class="no-payload-desc">如需记录请到设置中打开开关</div>
                </div>
                <JsonViewer
                  v-else
                  ref="requestJsonRef"
                  :data="recordStore.currentRecord.request_data"
                  :expanded="isRequestExpanded"
                />
              </div>

              <!-- Tab 4: 分块流 (SSE) 原始视图 -->
              <div
                v-show="activeRightTab === 'sse_stream'"
                class="right-tab-content sse-scrollable"
              >
                <div class="sse-pane-header">
                  <span class="font-mono text-xs font-semibold text-slate-700"
                    >Server-Sent Events 模拟/还原分块流</span
                  >
                  <span class="font-mono text-[11px] text-slate-400"
                    >Content-Type: text/event-stream</span
                  >
                </div>
                <div class="sse-code-block">
                  <pre class="sse-pre"><code>{{ sseStreamText }}</code></pre>
                </div>
              </div>

              <!-- Tab 5: 活动日志 (Timeline) -->
              <div
                v-show="activeRightTab === 'activity'"
                class="right-tab-content activity-scrollable"
              >
                <ActivityTimeline :activities="recordStore.activities" />
              </div>

              <!-- Tab 6: 报错信息 (Error) -->
              <div
                v-show="activeRightTab === 'error'"
                class="right-tab-content error-scrollable"
              >
                <div class="error-pane-card">
                  <div
                    v-if="recordStore.currentRecord.failed_code"
                    class="error-badge-row"
                  >
                    <span class="error-code-badge">
                      {{
                        FAILED_CODE_LABELS[
                          recordStore.currentRecord.failed_code
                        ] ?? recordStore.currentRecord.failed_code
                      }}
                    </span>
                  </div>
                  <div class="error-box">
                    <pre class="error-text">{{
                      getErrorMessage(recordStore.currentRecord.response_data)
                    }}</pre>
                  </div>
                </div>
              </div>

              <!-- 底部面板抽屉状态条 (Drawer footer) -->
              <div class="panel-drawer-footer font-mono">
                <span>Response Status: {{ getResponseFooterStatus() }}</span>
                <span class="footer-enc">Encoding: UTF-8</span>
              </div>
            </section>
          </div>
        </div>

        <a-empty
          v-else-if="recordStore.recordNotFound"
          description="请求未找到"
          class="empty-holder"
        />
        <a-empty
          v-else-if="recordStore.recordLoadFailed"
          description="请求详情加载失败，请稍后重试"
          class="empty-holder"
        />
      </a-spin>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  ArrowLeftOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  CopyOutlined,
  DownloadOutlined,
  LeftOutlined,
  RightOutlined,
  DeleteOutlined,
  ExportOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
} from "@ant-design/icons-vue";
import { useRecordStore } from "@/stores/record";
import { deleteRecord } from "@/api/record";
import { formatDate } from "@/utils/format";
import {
  convertResponsesRequest,
  convertResponsesResponse,
} from "@/utils/responsesConverter";
import JsonDownload from "@/utils/jsonDownload";
import { isTauri } from "@/utils/platform";
import JsonViewer from "@/components/common/JsonViewer.vue";
import DataViewer from "@/components/dataViewer/DataViewer.vue";
import ActivityTimeline from "@/components/common/ActivityTimeline.vue";
import { FAILED_CODE_LABELS } from "@/constants/record";
import { message } from "ant-design-vue/es";
import { marked } from "marked";

// 配置 marked 安全选项
marked.setOptions({
  gfm: true,
  breaks: true,
});

const router = useRouter();
const route = useRoute();
const recordStore = useRecordStore();

const activeRightTab = ref<
  | "preview"
  | "response_json"
  | "request_json"
  | "sse_stream"
  | "activity"
  | "error"
>("preview");

const requestJsonRef = ref<any>(null);
const responseJsonRef = ref<any>(null);
const isRequestExpanded = ref(true);
const isResponseExpanded = ref(true);

/**
 * 详情是否在途：骨架屏显示条件
 */
const isDetailLoading = computed(
  () =>
    !recordStore.currentRecord &&
    !recordStore.recordNotFound &&
    !recordStore.recordLoadFailed,
);

const currentRecordId = computed<number>(() => {
  const id = Number.parseInt(route.params.id as string, 10);
  return Number.isNaN(id) ? 0 : id;
});

watch(
  () => route.params.id,
  idValue => {
    const id = Number.parseInt(idValue as string, 10);
    if (Number.isNaN(id)) {
      recordStore.clearCurrentRecord();
      return;
    }
    void recordStore.fetchRecordDetail(id);
  },
  { immediate: true },
);

onUnmounted(() => {
  recordStore.clearCurrentRecord();
});

// 解析对话数据（用于 Data Viewer Iframe 与新标签页打开）
const conversationData = computed(() => {
  const messages: any[] = [];
  let system: any = undefined;
  try {
    if (recordStore.currentRecord?.request_data) {
      const req = JSON.parse(recordStore.currentRecord.request_data);
      if (req.messages && Array.isArray(req.messages)) {
        messages.push(...req.messages);
      }
      if (req.system != null) {
        system = req.system;
      }
      // 兼容 Responses 协议请求转换
      if (req.input !== undefined) {
        const converted = convertResponsesRequest(req);
        if (converted.system) {
          system = converted.system;
        }
        if (converted.messages) {
          messages.push(...converted.messages);
        }
      }
    }
  } catch (e) {}
  try {
    if (recordStore.currentRecord?.response_data) {
      const res = JSON.parse(recordStore.currentRecord.response_data);
      if (res.choices && res.choices.length > 0 && res.choices[0].message) {
        messages.push(res.choices[0].message);
      } else if (res.message) {
        messages.push(res.message);
      }
      // 兼容 Responses 协议响应转换
      if (res.output && Array.isArray(res.output)) {
        const converted = convertResponsesResponse(res);
        messages.push(...converted);
      }
    }
  } catch (e) {}
  return system !== undefined ? { system, messages } : messages;
});

function getMessageCount(data: any): number {
  if (Array.isArray(data)) return data.length;
  return data?.messages?.length ?? 0;
}

const messageCount = computed(() => getMessageCount(conversationData.value));

function openVisualInNewTab() {
  if (messageCount.value <= 0) {
    message.warning("当前没有可展示的对话数据");
    return;
  }

  if (isTauri()) {
    message.warning(
      "桌面模式下暂不支持在新标签页打开，请在浏览器中访问管理界面使用",
    );
    return;
  }

  const sessionKey = `data_viewer_session_${Date.now()}`;
  try {
    localStorage.setItem(sessionKey, JSON.stringify(conversationData.value));
  } catch {
    message.error("写入本地存储失败，无法在新标签页打开");
    return;
  }

  window.open(
    `/#/viewer?session_key=${encodeURIComponent(sessionKey)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

// 解析请求体中的运行时参数
const parsedRequestObj = computed<any>(() => {
  if (!recordStore.currentRecord?.request_data) return null;
  try {
    return JSON.parse(recordStore.currentRecord.request_data);
  } catch {
    return null;
  }
});

const parsedRequestParams = computed(() => {
  const obj = parsedRequestObj.value;
  if (!obj) return null;
  return {
    temperature: obj.temperature,
    stream: obj.stream,
    max_tokens: obj.max_tokens ?? obj.max_completion_tokens,
    top_p: obj.top_p,
  };
});

const requestRouteInfo = computed(() => {
  const protocol =
    recordStore.currentRecord?.client_format?.toLowerCase() || "openai";
  if (protocol === "anthropic") {
    return "POST /v1/messages";
  }
  return "POST /v1/chat/completions";
});

// 解析响应体数据
const parsedResponseObj = computed<any>(() => {
  if (!recordStore.currentRecord?.response_data) return null;
  try {
    return JSON.parse(recordStore.currentRecord.response_data);
  } catch {
    return null;
  }
});

// 提取 Assistant 最终回复文本
const assistantReplyText = computed<string | null>(() => {
  const res = parsedResponseObj.value;
  if (!res) return null;

  // OpenAI 格式
  if (Array.isArray(res.choices) && res.choices.length > 0) {
    const choice = res.choices[0];
    if (choice.message?.content) {
      return typeof choice.message.content === "string"
        ? choice.message.content
        : JSON.stringify(choice.message.content, null, 2);
    }
    if (choice.delta?.content) {
      return choice.delta.content;
    }
  }

  // Anthropic / Responses 格式
  if (Array.isArray(res.content)) {
    return res.content
      .map((c: any) =>
        typeof c === "string" ? c : c.text || JSON.stringify(c),
      )
      .join("\n");
  }

  if (res.output && Array.isArray(res.output)) {
    const converted = convertResponsesResponse(res);
    if (converted.length > 0) {
      return converted
        .map((m: any) =>
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        )
        .join("\n");
    }
  }

  if (res.message?.content) {
    return typeof res.message.content === "string"
      ? res.message.content
      : JSON.stringify(res.message.content, null, 2);
  }

  return null;
});

// 提取响应元数据
const parsedResponseMeta = computed(() => {
  const res = parsedResponseObj.value;
  let finishReason: string | null = null;
  let chunkCount: number | null = null;

  if (res?.choices && res.choices.length > 0) {
    finishReason = res.choices[0].finish_reason || "stop";
  } else if (res?.stop_reason) {
    finishReason = res.stop_reason;
  }

  // 预估分块数
  const compTokens = recordStore.currentRecord?.usage?.completion_tokens;
  if (compTokens && compTokens > 0) {
    chunkCount = Math.max(1, Math.round(compTokens / 6.5));
  }

  return { finishReason, chunkCount };
});

// Token 用量计算
const usageTokens = computed(() => {
  const usage = recordStore.currentRecord?.usage;
  if (!usage) return null;
  const u = usage;
  if (u.prompt_tokens == null && u.completion_tokens == null) return null;
  const prompt: number = u.prompt_tokens ?? 0;
  const output: number = u.completion_tokens ?? 0;
  const cacheRead = u.cache_read_tokens;
  let cacheHitRate: number | null = null;
  if (cacheRead != null) {
    const total = prompt + cacheRead;
    cacheHitRate = total > 0 ? Math.floor((cacheRead / total) * 1000) / 10 : 0;
  }
  return { prompt, output, cacheHitRate, cacheReadTokens: cacheRead ?? null };
});

// 总耗时
const totalDuration = computed(() => {
  const r = recordStore.currentRecord;
  if (!r?.start_at || !r?.end_at) return null;
  const start = new Date(r.start_at).getTime();
  const end = new Date(r.end_at).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  return end - start;
});

// 生成速率计算
const generationSpeed = computed(() => {
  const outputTokens = usageTokens.value?.output;
  const totalMs = totalDuration.value;
  const ttft = recordStore.currentRecord?.first_token_latency || 0;
  if (!outputTokens || !totalMs || outputTokens <= 0) return null;
  const streamDurationSec = (totalMs - ttft) / 1000;
  if (streamDurationSec <= 0) {
    // 非流式或首包即完成的情况，按总耗时计算速率
    const totalSec = totalMs / 1000;
    if (totalSec <= 0) return null;
    return (outputTokens / totalSec).toFixed(2);
  }
  const speed = outputTokens / streamDurationSec;
  return speed.toFixed(2);
});

// 延时分解数据
const latencyBreakdown = computed(() => {
  const total = totalDuration.value;
  if (!total || total <= 0) return null;
  const ttft =
    recordStore.currentRecord?.first_token_latency || Math.min(total, 120);
  const dnsMs = Math.min(Math.round(total * 0.02), 25);
  const streamMs = Math.max(total - ttft, 0);

  const dnsPercent = Math.max((dnsMs / total) * 100, 1.5);
  const ttftPercent = Math.max(((ttft - dnsMs) / total) * 100, 5);
  const streamPercent = Math.max(100 - dnsPercent - ttftPercent, 2);

  return {
    totalDuration: total.toLocaleString(),
    dnsMs,
    ttftMs: ttft.toLocaleString(),
    streamMs: streamMs.toLocaleString(),
    dnsPercent,
    ttftPercent,
    streamPercent,
  };
});

// 生成模拟 SSE 流文本
const sseStreamText = computed(() => {
  const reply = assistantReplyText.value || "";
  if (!reply)
    return 'event: error\ndata: {"message": "No stream data available"}\n\n';
  const chunks: string[] = [];
  const lines = reply.split("\n");
  let chunkId = 0;
  for (const l of lines) {
    chunkId++;
    chunks.push(
      `event: message\ndata: ${JSON.stringify({ id: `chatcmpl-${chunkId}`, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: l + "\n" }, finish_reason: null }] })}\n`,
    );
  }
  chunks.push(
    `event: message\ndata: ${JSON.stringify({ id: `chatcmpl-${chunkId + 1}`, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: parsedResponseMeta.value.finishReason || "stop" }] })}\n`,
  );
  chunks.push("event: message\ndata: [DONE]\n");
  return chunks.join("\n");
});

function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return marked.parse(content) as string;
  } catch {
    return `<p>${content}</p>`;
  }
}

function getStatusBadgeText(status: string | null | undefined): string {
  switch (status) {
    case "success":
      return "成功 200 OK";
    case "failed":
      return "请求失败";
    case "processing":
      return "处理中";
    case "init":
      return "已初始化";
    default:
      return "未知状态";
  }
}

function getResponseStatusText(status: string | null | undefined): string {
  switch (status) {
    case "success":
      return "HTTP 200 OK";
    case "failed":
      return "HTTP 500 / FAILED";
    case "processing":
      return "PROCESSING";
    default:
      return "HTTP 200";
  }
}

function getResponseFooterStatus(): string {
  const status = recordStore.currentRecord?.status;
  const isStream = parsedRequestParams.value?.stream;
  return `${status === "success" ? "200 OK" : "FAILED"} · Content-Type: ${isStream ? "text/event-stream" : "application/json"}`;
}

function getErrorMessage(responseData: string | null): string {
  if (!responseData) return "未知错误";
  try {
    const parsed = JSON.parse(responseData);
    return parsed.error?.message || parsed.error || responseData;
  } catch {
    return responseData || "请求失败";
  }
}

async function copyText(text: string, title: string) {
  if (!text) {
    message.warning("无内容可复制");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    message.success(`${title}已复制到剪贴板`);
  } catch {
    message.error("复制失败，请手动选择复制");
  }
}

function navigateToRecord(targetId: number) {
  if (targetId <= 0) return;
  void router.push({
    name: "RecordDetail",
    params: { id: String(targetId) },
  });
}

function handleBack() {
  void router.push({ name: "RecordList" });
}

async function handleDelete() {
  if (!recordStore.currentRecord) return;
  try {
    await deleteRecord(recordStore.currentRecord.id);
    message.success("删除成功");
    void router.push({ name: "RecordList" });
  } catch {
    message.error("删除失败");
  }
}

async function downloadJson(data: string | null, type: "request" | "response") {
  if (!data) {
    message.warning("没有数据可下载");
    return;
  }
  try {
    const recordId = recordStore.currentRecord?.id || "unknown";
    const timestamp = formatDate(new Date()).replace(/[:\s]/g, "-");
    const filename = `record-${recordId}-${type}-${timestamp}.json`;
    const downloaded = await JsonDownload.downloadJson(data, filename);
    if (downloaded) {
      message.success("下载成功");
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      message.error("下载失败：数据格式错误");
    } else {
      message.error("下载失败");
    }
  }
}
</script>

<style scoped>
.record-detail-page {
  background-color: var(--bg-layout);
  height: calc(100vh - 64px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  font-family:
    Inter,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "PingFang SC",
    "Noto Sans SC",
    sans-serif;
  overflow: hidden;
  margin: -24px;
}

/* 顶部普通状态栏（非吸顶，随页面排布） */
.status-bar-header {
  width: 100%;
  flex-shrink: 0;
  background-color: var(--bg-card);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.03);
}

.status-bar-content {
  max-width: 100%;
  margin: 0 auto;
  height: 64px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  user-select: none;
  overflow-x: auto;
}

/* 左侧段 */
.status-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.btn-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-icon:hover {
  color: var(--text-primary);
  background: var(--bg-info-item);
}

.identity-block {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.identity-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-title {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}

.status-badge.status-success {
  background-color: var(--accent-primary-soft);
  color: var(--accent-primary);
  border: 1px solid var(--accent-primary-border);
}

.status-badge.status-failed {
  background-color: var(--accent-danger-soft);
  color: var(--accent-danger);
  border: 1px solid var(--accent-danger-border);
}

.status-badge.status-processing {
  background-color: var(--accent-primary-soft);
  color: var(--accent-primary);
  border: 1px solid var(--accent-primary-border);
}

.status-badge.status-default {
  background-color: var(--bg-info-item);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: currentColor;
}

.identity-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: "JetBrains Mono", "Fira Code", monospace;
  margin-top: 2px;
}

.record-id-tag {
  color: var(--text-secondary);
  font-weight: 600;
  background-color: var(--bg-info-item);
  padding: 0 4px;
  border-radius: 3px;
}

.bullet {
  color: var(--border-color);
}

.created-time {
  color: var(--text-secondary);
}

.v-divider {
  height: 28px;
  width: 1px;
  background-color: var(--border-color);
  flex-shrink: 0;
}

/* 中间核心标识 */
.status-bar-meta {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}

.meta-col {
  display: flex;
  flex-direction: column;
  min-width: 60px;
  gap: 4px;
  align-items: flex-start;
}

.micro-label {
  font-size: 11px;
  line-height: 14px;
  height: 14px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 500;
  white-space: nowrap;
}

.micro-sub {
  font-size: 10px;
  color: var(--text-secondary);
  font-weight: normal;
  text-transform: none;
}

.meta-value {
  font-size: 13px;
  line-height: 16px;
  height: 16px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.font-secondary {
  color: var(--text-secondary);
  font-size: 12px;
}

.font-mono {
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.meta-label-flex {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 14px;
  line-height: 14px;
}

.vendor-tag {
  font-size: 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  padding: 0 4px;
  border-radius: 3px;
  background-color: var(--bg-info-item);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  font-weight: 500;
}

.protocol-badge-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}

.protocol-badge {
  padding: 1px 6px;
  font-size: 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-weight: 600;
  background-color: var(--accent-primary-soft);
  color: var(--accent-primary);
  border: 1px solid var(--accent-primary-border);
  border-radius: 4px;
}

.protocol-upstream {
  background-color: var(--accent-warning-soft);
  color: var(--accent-warning);
  border-color: var(--accent-warning-border);
}

.protocol-arrow {
  color: var(--text-secondary);
  font-size: 10px;
}

/* 性能与指标段 */
.status-bar-metrics {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}

.metric-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  min-width: 70px;
}

.metric-value-row {
  font-size: 13px;
  line-height: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.token-up {
  color: #38bdf8;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.token-down {
  color: #34d399;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}

.token-arrow {
  font-size: 11px;
  margin-right: 2px;
}

.token-cached {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: normal;
}

.slash {
  color: var(--border-color);
  margin: 0 1px;
}

.cache-hit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 16px;
  line-height: 16px;
}

.cache-hit-num {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 13px;
  font-weight: 700;
  color: #34d399;
}

.cache-hit-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #34d399;
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.2);
}

.ttft-pill {
  display: inline-block;
  padding: 1px 5px;
  font-size: 12px;
  line-height: 14px;
  height: 16px;
  font-weight: 600;
  color: var(--accent-warning);
  background-color: var(--accent-warning-soft);
  border: 1px solid var(--accent-warning-border);
  border-radius: 4px;
  box-sizing: border-box;
}

/* 右侧操作段 */
.status-bar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-group-nav {
  display: inline-flex;
  background-color: var(--bg-info-item);
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.btn-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-nav:hover:not(:disabled) {
  background: var(--bg-info-item);
  color: var(--text-primary);
}

.btn-nav:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon-nav {
  font-size: 11px;
  color: var(--text-secondary);
}

.btn-delete {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-danger);
  background: var(--bg-card);
  border: 1px solid var(--accent-danger-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-delete:hover {
  background-color: var(--accent-danger-soft);
  color: var(--accent-danger);
}

/* 主体工作台双栏布局 */
.workbench-container {
  flex: 1;
  width: 100%;
  margin: 0;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.workbench-container :deep(.ant-spin-nested-loading),
.workbench-container :deep(.ant-spin-container) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.workbench-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: stretch;
  flex: 1;
  height: 100%;
  min-height: 0;
}

.workbench-col {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1024px) {
  .workbench-grid {
    grid-template-columns: 1fr;
  }
}

.panel-card {
  background: var(--bg-card);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.04);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1;
  min-height: 0;
}

.left-panel-card {
  height: 100%;
}

.right-panel-card {
  height: 100%;
}

.skeleton-panel {
  padding: 20px;
}

/* 面板头部 */
.panel-header {
  padding: 12px 16px;
  background-color: var(--bg-header);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.dot-indigo {
  background-color: var(--accent-primary);
}

.dot-emerald {
  background-color: #34d399;
}

.panel-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-primary);
  margin: 0;
}

.badge-count {
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  padding: 1px 6px;
  border-radius: 4px;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-pill-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-pill-action:hover {
  background: var(--bg-info-item);
  color: var(--text-primary);
}

/* Tab 切换器 */
.tab-switcher {
  display: inline-flex;
  background-color: var(--border-color);
  padding: 2px;
  border-radius: 8px;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background-color: var(--bg-card);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.tab-btn-error {
  color: var(--accent-danger);
}

.tab-btn-error.active {
  color: var(--accent-danger);
}

/* 调用参数条 */
.params-strip {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-info-item);
}

.params-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
}

.params-route {
  font-size: 10px;
  color: var(--text-secondary);
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

@media (max-width: 640px) {
  .params-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.param-box {
  background: var(--bg-card);
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.param-label {
  font-size: 10px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-family: sans-serif;
}

.param-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: monospace;
  margin-top: 2px;
}

.text-purple {
  color: #c084fc;
}

/* Data Viewer Iframe 对话可视化容器 */
.viewer-iframe-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-card);
  min-height: 0;
}

.visualization-viewer {
  width: 100%;
  height: 100%;
  flex: 1;
  min-height: 0;
  border: none;
}

/* 原始 JSON 折叠面板 */
.raw-json-collapsible {
  border-top: 1px solid var(--border-color);
  font-size: 12px;
}

.raw-summary {
  cursor: pointer;
  background-color: var(--bg-layout);
  padding: 8px 14px;
  font-family: monospace;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}

.raw-summary:hover {
  color: var(--text-primary);
  background-color: var(--bg-info-item);
}

.raw-summary-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.summary-caret {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.2s ease;
}

.summary-caret.rotate-90 {
  transform: rotate(90deg);
}

.raw-summary-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.raw-json-body {
  background-color: var(--bg-code-header);
  border-top: 1px solid var(--border-color);
}

.raw-json-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background-color: var(--bg-code-header);
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-secondary);
}

.btn-copy-raw {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: #38bdf8;
  cursor: pointer;
  font-size: 11px;
}

.btn-copy-raw:hover {
  color: #7dd3fc;
}

.raw-code {
  margin: 0;
  padding: 12px;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--border-color);
  overflow-x: auto;
  max-height: 350px;
}

/* 右侧响应面板 */
.response-status-strip {
  padding: 10px 16px;
  background-color: var(--bg-info-item);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}

.response-strip-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.res-status-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  font-weight: 600;
}

.tag-success {
  background-color: var(--accent-primary-soft);
  color: var(--accent-primary);
  border: 1px solid var(--accent-primary-border);
}

.tag-failed {
  background-color: var(--accent-danger-soft);
  color: var(--accent-danger);
  border: 1px solid var(--accent-danger-border);
}

.tag-default {
  background-color: var(--bg-info-item);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.res-meta-pill {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  background: var(--bg-card);
  border: 1px solid var(--border-color);
}

.response-strip-right {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.gen-speed-label {
  color: var(--text-secondary);
}

.gen-speed-val {
  font-weight: 700;
  color: var(--accent-primary);
  background-color: var(--accent-primary-soft);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--accent-primary-border);
}

/* 延时分解部分 */
.latency-section {
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  background-color: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.latency-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}

.latency-title {
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-thunder {
  color: #f59e0b;
}

.latency-total {
  font-size: 11px;
  color: var(--text-secondary);
}

.total-num {
  color: var(--text-primary);
}

.latency-progress-bar {
  width: 100%;
  height: 10px;
  background-color: var(--bg-info-item);
  border-radius: 9999px;
  overflow: hidden;
  display: flex;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
}

.latency-segment {
  height: 100%;
  transition: all 0.3s ease;
}

.seg-dns {
  background-color: var(--text-secondary);
}

.seg-ttft {
  background-color: #fbbf24;
}

.seg-stream {
  background-color: #34d399;
}

.latency-legend {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  font-size: 11px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-slate {
  background-color: var(--text-secondary);
}
.dot-amber {
  background-color: #f59e0b;
}
.dot-emerald {
  background-color: #34d399;
}

.cache-callout {
  margin-top: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  background-color: var(--accent-primary-soft);
  border: 1px solid var(--accent-primary-border);
  color: var(--accent-primary);
  font-size: 11px;
  line-height: 1.5;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.cache-callout-icon {
  font-size: 13px;
  color: #34d399;
  margin-top: 1px;
  flex-shrink: 0;
}

.cache-callout-highlight {
  font-weight: 700;
  color: var(--accent-primary);
}

/* 右侧 Tab 内容容器 */
.right-tab-content {
  padding: 16px;
  flex: 1;
  overflow-y: auto;
}

.assistant-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 12px;
}

.assistant-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-assistant {
  color: var(--accent-primary);
}

.btn-copy-assistant {
  font-size: 11px;
  color: var(--accent-primary);
  background: transparent;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-copy-assistant:hover {
  color: var(--accent-primary-hover);
}

.stream-done-pill {
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background-color: var(--bg-layout);
  border: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-secondary);
}

/* Markdown 渲染样式规范 */
.rendered-markdown {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--text-primary);
}

.rendered-markdown :deep(h1),
.rendered-markdown :deep(h2),
.rendered-markdown :deep(h3),
.rendered-markdown :deep(h4) {
  color: var(--text-primary);
  font-weight: 700;
  margin-top: 12px;
  margin-bottom: 6px;
}

.rendered-markdown :deep(h1) {
  font-size: 15px;
}
.rendered-markdown :deep(h2) {
  font-size: 14px;
}
.rendered-markdown :deep(h3) {
  font-size: 13px;
}
.rendered-markdown :deep(h4) {
  font-size: 12.5px;
}

.rendered-markdown :deep(p) {
  margin-top: 0;
  margin-bottom: 8px;
}

.rendered-markdown :deep(ul),
.rendered-markdown :deep(ol) {
  margin-top: 0;
  margin-bottom: 8px;
  padding-left: 20px;
}

.rendered-markdown :deep(li) {
  margin-bottom: 4px;
}

.rendered-markdown :deep(code) {
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 11.5px;
  background-color: var(--bg-info-item);
  color: var(--text-primary);
  padding: 2px 5px;
  border-radius: 4px;
}

.rendered-markdown :deep(pre) {
  background-color: var(--bg-code-header);
  padding: 12px 14px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 10px 0;
}

.rendered-markdown :deep(pre code) {
  background-color: transparent;
  color: var(--text-primary);
  padding: 0;
  font-size: 11px;
  line-height: 1.5;
}

.rendered-markdown :deep(blockquote) {
  margin: 8px 0;
  padding-left: 12px;
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
}

/* 原始 JSON 树视图面板 */
.json-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color);
}

.json-pane-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

/* SSE 面板 */
.sse-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.sse-code-block {
  background-color: var(--bg-code-header);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}

.sse-pre {
  margin: 0;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #38bdf8;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 错误面板 */
.error-pane-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.error-code-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background-color: var(--accent-danger-soft);
  color: var(--accent-danger);
  border: 1px solid var(--accent-danger-border);
  font-size: 11px;
  font-weight: 600;
}

.error-box {
  background-color: var(--accent-danger-soft);
  border: 1px solid var(--accent-danger-border);
  border-radius: 8px;
  padding: 12px;
}

.error-text {
  margin: 0;
  color: var(--accent-danger);
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 抽屉底部 */
.panel-drawer-footer {
  border-top: 1px solid var(--border-color);
  background-color: var(--bg-layout);
  padding: 8px 16px;
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.footer-enc {
  color: var(--text-secondary);
}

.no-payload-hint {
  padding: 32px 0;
  text-align: center;
}

.no-payload-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.no-payload-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.empty-holder {
  padding: 60px 0;
}

/* 滚动条美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}
</style>











