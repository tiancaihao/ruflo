## Why

RuFlo 的 Managed Agent 层 (`managed_agent_*` MCP 工具) 调用 Anthropic 专有云服务 `api.anthropic.com/v1/sessions`，该 API 需要 `ANTHROPIC_API_KEY` + `anthropic-beta: managed-agents-2026-04-01` 头，是 Anthropic 云端托管 agent 环境（Agent + Environment + Session），DeepSeek/Qwen 等国产 provider 没有等价服务。

经过对上游 `ruvnet/ruflo` 源码的完整分析：
- `managed_agent_*` 工具通过 `fetch` 直接调用 Anthropic REST API，无任何 provider 抽象层
- 与 `agent_execute`（已通过 setup.sh patch 支持多 provider）不同，Managed Agent 不是 LLM 调用，而是云容器编排
- Layer 2 WASM Agent 的 LLM 调用已 patch，但被 `ANTHROPIC_API_KEY` 前置检查拦截

因此需要用 DeepSeek/Qwen 原生的 function calling API 构建本地 agent loop，以 `local_agent_*` 新工具集替代 `managed_agent_*`。

## What Changes

- **新增**: `local_agent_*` MCP 工具集 — 镜像 `managed_agent_*` 生命周期 API
- **新增**: 本地 agent loop 核心 — 多轮 function calling + 本地 tool 执行
- **新增**: 层次化上下文摘要 — 解决长任务 context 膨胀
- **新增**: 断点续跑 (checkpoint/resume) — 崩溃后可恢复
- **新增**: 异步后台模式 — 长任务非阻塞执行 + 实时进度
- **新增**: 并行 tool 执行 — 独立工具并发运行
- **修复**: Layer 2 WASM Agent `ANTHROPIC_API_KEY` 前置拦截移除
- **兼容**: 不删除 `managed_agent_*`，通过新工具集 `local_agent_*` 共存

## Capabilities

### New Capabilities
- `local-agent-loop`: 基于 DeepSeek/Qwen function calling API 的多轮 agent tool loop，含摘要、checkpoint、异步、并行执行
- `local-agent-lifecycle`: local_agent_create/prompt/status/events/list/terminate 完整生命周期

## 与上游架构的关系

```
RuFlo 架构 (两种安装路径均适用):

┌──────────────────────────────────────┐
│  Swarm 协调层 (@claude-flow/swarm)    │  ← 不受 patch 影响
│  QueenCoordinator / Raft / MessageBus│     仅在 Path B (npx ruflo init)
│  负责: 多 Agent 任务分配和协作         │     完整安装时加载
└──────────────┬───────────────────────┘
               │ 每个 Agent 执行任务时调用
               ▼
┌──────────────────────────────────────┐
│  Agent 执行层 (我们的 patch 范围)      │
│                                      │
│  L1: agent_execute → 多 provider     │  ← setup.sh patch
│  L2: wasm_agent_*  → 移除 key 拦截   │  ← setup.sh patch
│  L3: local_agent_* → 本地 tool loop  │  ← setup.sh 注入
└──────────────────────────────────────┘
```

- **Path A (轻量插件)** 和 **Path B (完整 CLI)** 均适用：两种路径最终都调用同一套 Agent 执行函数
- Swarm 协调层与 Agent 执行层无耦合：Swarm 只管"谁干什么"，不管底层调用哪个 LLM
- 上游更新 → fork 同步 → setup.sh 继续生效，不需要修改任何包

## Impact

- `mcp-tools/local-agent-tools.ts`: 新增 (~400 行) — local_agent_* 6 个 MCP 工具定义
- `mcp-tools/local-agent-loop.ts`: 新增 (~300 行) — callAgentLoop + 摘要 + checkpoint 核心函数
- `ruvector/agent-wasm.js`: patch ANTHROPIC_API_KEY 前置拦截 (Layer 2 修复)
- `scripts/setup.sh`: 新增 local agent loop + Layer 2 修复 patch 注入
- `mcp-tools/index.ts`: 注册 localAgentTools
- `managed-agent-tools.ts`: 无需修改 (managed_agent_* 保持不变)
