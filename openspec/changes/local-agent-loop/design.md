## Context

RuFlo v3.7.0 有三层 agent 执行体系，每层对 Anthropic 的依赖不同：

```
Layer 1: agent_execute         → POST /v1/messages (LLM API)
Layer 2: wasm_agent_*          → POST /v1/messages (LLM API) + WASM 沙箱
Layer 3: managed_agent_*       → POST /v1/sessions (云容器编排 API)
```

- **Layer 1** 已通过 setup.sh patch 支持多 provider (DeepSeek/Qwen/Kimi/Zhipu/Doubao)
- **Layer 2** LLM 路由已 patch，但 `agent-wasm.js:115-117` 的 `ANTHROPIC_API_KEY` 前置检查拦截了非 Anthropic 请求
- **Layer 3** 调用 Anthropic 专有云 API，无法用其他 provider 的 key 访问

本文档聚焦 **Layer 2 修复** 和 **Layer 3 本地替代方案**。

## Goals / Non-Goals

**Goals:**
- Layer 2: 移除 WASM Agent 的 ANTHROPIC_API_KEY 前置拦截
- Layer 3: 构建 `local_agent_*` 工具集，用 DeepSeek function calling 实现本地 agent loop
- 长任务支持: 上下文摘要、断点恢复、异步执行
- 多 provider 兼容: DeepSeek, Qwen (OpenAI function calling 格式)

**Non-Goals:**
- 不删除或修改 `managed_agent_*` (保留给有 Anthropic key 的用户)
- 不涉及 `@claude-flow/swarm` 协调引擎 (未分发，独立 alpha 包)
- 不涉及 Ollama/本地模型场景
- 不修改 `agent_execute` 单轮行为

---

## Part 1: 与 Anthropic Managed Agent 的差异

### 架构对比

```
Anthropic Managed Agent (云端)          Local Agent Loop (本地)
══════════════════════════════          ══════════════════════════

managed_agent_create:                   local_agent_create:
  POST /v1/agents (创建 agent 定义)      创建 .claude-flow/agents/{id}/ 目录
  POST /v1/environments (创建容器)       初始化 checkpoint.json + transcript.json
  POST /v1/sessions (创建 session)       
  → 返回 {sessionId, agentId, envId}

managed_agent_prompt:                   local_agent_prompt:
  POST /v1/sessions/{id}/events          while (未完成):
    (user.message)                         POST DeepSeek API (tools[])
  poll events until idle                   if tool_calls → 本地执行 → 追加结果
  → 返回完整 event stream                  else → 完成
                                          → 返回最终结果 + transcript

managed_agent_status:                   local_agent_status:
  GET /v1/sessions/{id}                  读取 checkpoint.json
  → {status, model, ...}                 → {status, turnCount, progress}

managed_agent_events:                   local_agent_events:
  GET /v1/sessions/{id}/events           读取 transcript.json
  → 完整 event 流                         → 完整消息历史

managed_agent_terminate:                local_agent_terminate:
  DELETE /v1/sessions/{id}               删除 agent 目录
```

### 短任务性能对比 (3-10 轮)

```
                    Anthropic Managed Agent          本地 Agent Loop (DeepSeek)
                    ═══════════════════════          ══════════════════════════

Session 创建         2-5s (POST /v1/sessions)         <10ms (本地 mkdir)
  ↓
第1轮 LLM            Claude Opus: ~4-8s               DeepSeek-V4: ~2-5s
  ↓
Tool 执行            云端容器内 (~200ms-2s)            本地 Node.js (~10-50ms)
  ↓
第2轮 LLM            ~3-6s (cache hit)                ~2-4s
  ↓
Tool 执行            ~200ms                            ~10ms
  ↓
第3轮 LLM            ~2-4s                            ~1-3s
  ↓
结果轮询             1.5s × N                         0 (同步返回)
  ↓
─────────────────────────────────────────────────────────────────────
总计                 15-30s                            8-15s
```

| 维度 | Anthropic Managed | 本地 Loop | 胜者 |
|------|------------------|-----------|------|
| 冷启动 | 5-30s (容器启动) | <10ms | **本地** |
| LLM 推理速度 | Opus 4-8s/轮 | DeepSeek-V4 2-5s/轮 | **本地** |
| Tool 执行延迟 | 200ms-2s | 10-50ms | **本地** |
| 轮询开销 | 1.5s × N 轮 | 0 | **本地** |
| 成本 | Token + 容器时长 | 仅 Token | **本地 (55x)** |
| 多 Provider | 仅 Anthropic | DeepSeek/Qwen/5+ | **本地** |

---

## Part 2: Long Task Architecture

### 挑战

```
┌─────────────────────────────────────────────────────────────────┐
│                    长任务 Agent Loop 四大难题                     │
├─────────────────┬───────────────────────────────────────────────┤
│ 1. 上下文膨胀   │ 每轮追加 ~1-3K tokens，20轮后 context 爆炸     │
│                 │ DeepSeek 64K 窗口，40轮后必定溢出              │
├─────────────────┼───────────────────────────────────────────────┤
│ 2. 崩溃恢复     │ 15 轮后进程崩溃 → 状态丢失 → 从头开始          │
│                 │ 云端: session 服务端持久化，自动恢复            │
├─────────────────┼───────────────────────────────────────────────┤
│ 3. 用户体验     │ 20 轮 × 3s = 60s 阻塞等待                     │
│                 │ 云端: 后台执行 + 事件流推送                     │
├─────────────────┼───────────────────────────────────────────────┤
│ 4. Token 成本   │ 无 cache，每轮携带全部历史                     │
│                 │ 云端: prompt cache 命中 95%                    │
└─────────────────┴───────────────────────────────────────────────┘
```

### 解法 1: 层次化上下文摘要

```
轮次       上下文结构                              估算 Token
────────────────────────────────────────────────────────────────
1-5        [system] [所有5轮原文]                   ~8K
6-10       [system] [摘要(1-5)] [原文(6-10)]        ~10K
11-15      [system] [摘要(1-10)] [原文(11-15)]      ~10K
16-20      [system] [摘要(1-15)] [原文(16-20)]      ~10K
...        ...                                      ~10K (恒定!)
────────────────────────────────────────────────────────────────
```

**摘要内容**: 已完成操作、任务状态、错误和修复、下一步计划

**关键指标**: 上下文恒定 ~10K，永不超过 64K 窗口上限

### 解法 2: 断点续跑

```
.claude-flow/agents/{agentId}/
├── checkpoint.json          ← 原子写入 (write-tmp → rename)
│   ├── messages[]           ← 完整消息数组 (含摘要)
│   ├── turnCount
│   ├── contextSummary
│   ├── toolResults{}
│   └── lastCheckpointAt
├── transcript.json          ← 完整事件流 (追加写入)
└── store.json               ← agent 元数据 (已有)
```

**恢复流程**:
```
local_agent_prompt({agentId, prompt})
  ↓
检查 checkpoint.json 是否存在
  ├── 否 → 全新开始
  └── 是 → 从 checkpoint 继续
      支持: resume (继续) / reset (重置) / continue (追加 prompt)
```

### 解法 3: 异步后台执行

```
同步模式 (短任务)              异步模式 (长任务)
═══════════════════            ═══════════════════

local_agent_prompt({           local_agent_prompt({
  prompt,                        prompt,
})                               async: true
                               })
  ↓                             ↓
阻塞等待 (10-60s)               立即返回 {
                                  taskId: "...",
                                  status: "started"
                                }
  ↓                             ↓
返回最终结果                    local_agent_status() 实时查询 {
                                  status: "running",
                                  currentTurn: 12,
                                  lastOutput: "...",
                                  progress: "60%"
                                }
```

### 解法 4: 并行 Tool 执行

DeepSeek/Qwen 支持单次返回多个 tool_call:
```
串行: LLM → tool_1 → LLM → tool_2 → LLM → tool_3 → ...  (6 次 API 调用)
并行: LLM → [tool_1, tool_2, tool_3] → 结果合并 → LLM   (2 次 API 调用)
```

---

## Decisions

### Decision 1: OpenAI function calling 协议
- **选型**: OpenAI tools/functions 格式 (DeepSeek/Qwen/Kimi 都支持)
- **理由**: 一套代码覆盖 5+ provider，与现有 `callOpenAICompat` 函数一致

### Decision 2: 新建 `local_agent_*` 工具集，不替换 `managed_agent_*`
- **选型**: 新增 6 个 MCP 工具 `local_agent_create/prompt/status/events/list/terminate`
- **理由**: 
  - `managed_agent_*` 保留给有 Anthropic key 的用户
  - 新工具用 DeepSeek/Qwen key，互不冲突
  - 向后兼容，不破坏任何现有功能

### Decision 3: 5 个预定义工具 + 白名单 + 路径沙箱
- **工具**: read_file, write_file, edit_file, run_bash, list_files
- **安全**: 
  - 工具名白名单 (非白名单返回错误)
  - 路径 resolve → verify 在 project root 内 → 拒绝 `../` 越权
  - run_bash: 危险命令检测 + 30s 超时 + 输出截断 2000 字符

### Decision 4: 层次化摘要 (非简单截断)
- **选型**: 每 5 轮触发摘要，保留最近 5 轮原文
- **摘要 LLM**: 用 flash 模型 ($0.0001/次)，独立于主任务模型
- **替代方案**: sliding window → 丢失早期关键决策，不采用

### Decision 5: 同步 + 异步双模式
- **选型**: `async: false` (默认) 同步返回，`async: true` 后台执行
- **理由**: 短任务期望即时结果；长任务需非阻塞

### Decision 6: 原子 Checkpoint
- **选型**: write-tmp → rename，每轮一次
- **频率**: 每轮一次 (非每个 tool 一次，避免 IO 开销)

### Decision 7: Layer 2 修复 — 移除 API key 前置检查
- **选型**: patch `agent-wasm.js` 的 `if (!process.env.ANTHROPIC_API_KEY)` 检查
- **改为**: `if (!process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY)` 
- **理由**: 让已 patch 的 LLM 路由正常工作

---

## Local Agent Loop 完整架构

```
local_agent_prompt({agentId, prompt, async?: true})
  │
  ├── async: false (同步)
  │   └── while (turn < 50) {
  │         ┌─ 检查 checkpoint (resume/restart)
  │         ├─ 构建 messages [system, history..., {role, prompt}]
  │         ├─ 每5轮触发摘要 → 用 flash 模型压缩旧轮次
  │         ├─ POST DeepSeek/Qwen API (tools[])
  │         ├─ 返回 text → 返回最终结果
  │         ├─ 返回 tool_calls[]:
  │         │   ├─ 并行执行 (Promise.all)
  │         │   ├─ 每个 tool: 白名单校验 → 路径沙箱 → 执行 → 结果截断
  │         │   └─ 追加 tool 结果到 messages
  │         ├─ 写 checkpoint (write-tmp → rename)
  │         └─ 继续循环
  │       }
  │
  └── async: true (异步)
      ├─ 立即返回 {taskId, status: "started"}
      ├─ setImmediate 中执行上述 loop
      ├─ 每轮更新 checkpoint.json
      └─ 完成时写 status: "idle" + final result
```

### 工具定义 (OpenAI Function Calling JSON Schema)

```typescript
const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read file contents at the given path",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path within project" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace a string in a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" }
        },
        required: ["path", "old_string", "new_string"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_bash",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files in a directory",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  }
];
```

---

## Relation to @claude-flow/swarm

```
┌──────────────────────────────────────────────────────┐
│  Swarm 协调层 (上游 @claude-flow/swarm)               │
│                                                      │
│  仅在 Path B (npx ruflo init → MCP server) 加载      │
│  Path A (轻量插件) 不包含此层                         │
│                                                      │
│  负责: 多 Agent 拓扑、共识、消息总线、任务分配         │
│  不直接调用 LLM API → 与 provider 无关               │
│  我们的 patch 完全不触及此层                           │
└──────────────────┬───────────────────────────────────┘
                   │ 每个 Agent 执行任务时
                   ▼
┌──────────────────────────────────────────────────────┐
│  Agent 执行层 (我们的 patch 范围: L1/L2/L3)           │
│                                                      │
│  setup.sh 注入的 callDeepSeekMessages 等函数          │
│  对 Swarm 完全透明 — Swarm 不关心底层是什么 LLM       │
└──────────────────────────────────────────────────────┘
```

- **Path A 和 Path B 均适用**：两种路径最终调用同一套 Agent 执行函数
- **零耦合**：Swarm 分配任务给 Agent，Agent 调 LLM — 两层的接口是"执行任务"，不是"调用哪个 API"

## Concurrency Model

### Async local_agent 并发上限: 默认 3

```
local_agent_prompt({async: true}) × 3
  ├── loop_1 → Node.js 事件循环 → DeepSeek API (等待 I/O)
  ├── loop_2 → Node.js 事件循环 → DeepSeek API (等待 I/O)
  └── loop_3 → Node.js 事件循环 → DeepSeek API (等待 I/O)
```

| 瓶颈 | 说明 |
|------|------|
| DeepSeek API QPS | 免费/低价 tier 通常 5-10 QPS，3 个 loop 已消耗 1-2 QPS |
| Node.js 单线程 | 工具执行 (bash/文件 I/O) 在事件循环中排队 |
| 本地 CPU/磁盘 | 多个 loop 同时跑重命令会互相争抢资源 |

可通过 `MAX_CONCURRENT_LOCAL_AGENTS` 环境变量调整，企业版 API 可设更高。

**与 managed_agent 对比**：
- managed_agent: 每个 session 在 Anthropic 云端有独立容器，真正物理并行，理论上无限扩展
- local_agent: 共享一个 Node.js 进程，异步并发但共享资源，适合 1-3 个并行任务

### 与 Swarm Agent 的区别

| | Swarm Agent 数 [0/15] | local_agent 并发上限 [3] |
|---|---|---|
| 层面 | 协调层 — 多少个角色 Agent 在协作 | 执行层 — 多少个 local_agent loop 在后台跑 |
| 关系 | 15 个 Agent 各自独立 | 每个 Agent 可选用 L1/L2/L3 任意方式执行 |
| 示例 | 1 Swarm 任务 spawn 8 个 Agent | 其中 2 个用 L3 异步模式 → 在 3 的上限内 |

## Result Delivery: 同步 vs 云端流式

```
Anthropic 云托管                          Local Agent Loop
════════════════                          ════════════════

POST /v1/sessions/{id}/events             POST DeepSeek (stream: false)
  ↓                                         ↓
SSE 实时推送:                              等完整响应 (2-5s)
  data: {"type": "thinking"}               ↓
  data: {"type": "tool_call", ...}        收到完整 JSON
  data: {"type": "tool_result", ...}       ↓
  ...                                     本地执行 tool
  data: {"type": "done"}                   ↓
                                          继续下一轮或返回最终结果

  用户能看到逐步进展                        同步模式: 只能等最终结果
  可以中途干预                              异步模式: local_agent_status 快照
```

| 影响 | 云托管 | 本地同步 | 本地异步 |
|------|--------|---------|---------|
| 实时可见 Agent 思考 | 原生 SSE | 无 | 无 (只有进度快照) |
| 中途干预 | 支持 | 不支持 | 只能 terminate |
| 额外延迟 | 每轮 +1.5s 轮询 | 零 | 零 |
| 连接断开 | Session 继续跑 | N/A (本地) | N/A (本地) |
| 进程崩溃 | 不受影响 | 靠 checkpoint 恢复 | 靠 checkpoint 恢复 |

**后续增强**: DeepSeek API 支持 `stream: true` (SSE)，可改造 MCP transport 层实现实时事件推送，接近云端 experience。

## Risks / Trade-offs

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 摘要丢失关键细节 | 中 | 摘要 prompt 包含 "保留所有文件路径和错误信息" |
| DeepSeek function calling 不稳定 | 中 | 实测验证 + fallback 到单轮模式 |
| 异步模式内存泄漏 | 低 | 10 分钟超时自动终止 |
| 摘要额外 LLM 调用成本 | 低 | flash 模型 ~$0.0001/次 |
| 并行 tool 执行顺序依赖 | 中 | 检测到文件依赖时降级串行 |
| Provider function calling 差异 | 中 | 统一 OpenAI 格式，各 provider 独立测试 |
| Bash 命令安全 | 高 | 危险模式检测 + 超时 + 输出截断 |
| 本地并发资源争抢 | 中 | 默认上限 3，可配置，资源监控 |
| 结果可见性不如云端 SSE | 低 | 异步模式 + transcript.json 增量写入；后续可加 SSE |

## Layer 2 WASM Agent 修复

```
当前代码 (agent-wasm.js:115-117):
  if (!process.env.ANTHROPIC_API_KEY) {
    return `${wasmResult}\n[NOTE: bundled WASM agent has no LLM...]`;
  }

修复后:
  if (!process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    return `${wasmResult}\n[NOTE: bundled WASM agent has no LLM...]`;
  }
```

这样当 DEEPSEEK_API_KEY 存在时，请求会通过已 patch 的 `callAnthropicMessages` 
→ `callDeepSeekMessages` 路由正常执行。
