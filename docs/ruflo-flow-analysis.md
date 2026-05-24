# ruflo 完整执行流程与 Patch 对照

> 基于 ruflo v3.7.0-alpha.79 + @claude-flow/cli v3.7.0-alpha.11
> 生成时间: 2026-05-24

---

## 1. 安装 (npm install -g ruflo)

```
npm install -g ruflo@latest
  → ~/.nvm/versions/node/vXX/lib/node_modules/ruflo/
    ├── bin/ruflo.js          ← CLI 入口 (thin wrapper)
    ├── package.json           ← main: bin/ruflo.js, dependencies: @claude-flow/cli
    └── node_modules/@claude-flow/cli/
        ├── bin/cli.js         ← 真正的 MCP stdio 服务器
        └── dist/src/
            ├── mcp-client.js           ← 工具注册 & dispatch
            ├── mcp-tools/
            │   ├── index.js            ← 工具导出汇总
            │   ├── agent-tools.js      ← agent_spawn, agent_execute
            │   ├── agent-execute-core.js ← ★ LLM 调用核心 (我们的 patch 目标)
            │   └── ...
            └── ruvector/
                └── agent-wasm.js       ← WASM agent (L2 patch 目标)
```

## 2. ruflo init --force

创建项目脚手架，写入 `.mcp.json`:

```json
{
  "mcpServers": {
    "ruflo": {
      "command": "npx",
      "args": ["-y", "ruflo@latest", "mcp", "start"],
      "env": {
        "CLAUDE_FLOW_MODE": "v3",
        "CLAUDE_FLOW_HOOKS_ENABLED": "true",
        "CLAUDE_FLOW_TOPOLOGY": "hierarchical-mesh",
        "CLAUDE_FLOW_MAX_AGENTS": "15",
        "CLAUDE_FLOW_MEMORY_BACKEND": "hybrid"
      },
      "autoStart": false
    }
  }
}
```

**关键**: `env` 里只有 CLAUDE_FLOW_* 变量，**没有** ANTHROPIC_API_KEY / DEEPSEEK_API_KEY 等。

同时创建: `.claude/` (skills/commands/agents/settings), `.claude-flow/` (config/data/logs), `CLAUDE.md`

## 3. MCP 服务器启动 (Claude Code → ruflo mcp start)

```
┌─────────────────────────────────────────────────────────────────┐
│ Claude Code                                                      │
│   ├─ 读取 .mcp.json                                              │
│   ├─ 提取 mcpServers.ruflo.env → 作为子进程环境变量注入            │
│   └─ 启动子进程: ruflo mcp start                                  │
│        │                                                         │
│        ▼                                                         │
│ ruflo.js (bin/ruflo.js)                                         │
│   ├─ findCliPath() → 找到 @claude-flow/cli                       │
│   ├─ 检测 MCP 模式: !process.stdin.isTTY → MCP 模式               │
│   └─ import @claude-flow/cli/bin/cli.js                          │
│        │                                                         │
│        ▼                                                         │
│ cli.js (MCP stdio 服务器)                                        │
│   ├─ import mcp-client.js { listMCPTools, callMCPTool, hasTool }│
│   ├─ process.stdin.on('data') → JSON-RPC 消息循环                 │
│   ├─ tools/list  → listMCPTools()                                │
│   └─ tools/call  → callMCPTool(name, params)                     │
└─────────────────────────────────────────────────────────────────┘
```

**API Key 来源**: 100% 来自 `process.env`，由 Claude Code 从 `.mcp.json` 的 `env` 字段注入到子进程。没有 config.yaml 读取，没有其他来源。

## 4. 工具注册与 Dispatch

```
mcp-client.js
  ├─ TOOL_REGISTRY = new Map()    ← 全局工具注册表
  ├─ listMCPTools()               ← 返回所有工具的 name/description/inputSchema
  ├─ callMCPTool(name, input)     ← 查找注册表 → 调用 handler(input)
  └─ hasTool(name)                ← 检查工具是否存在
```

工具在各自模块中注册到 TOOL_REGISTRY:

| 工具名 | 定义文件 | Handler |
|--------|---------|---------|
| `agent_spawn` | agent-tools.js:169 | 创建 agent 元数据，**不调用 LLM** |
| `agent_execute` | agent-tools.js:294 | → `executeAgentTask(input)` |
| (其他 60+ 工具) | ... | 不经过 agent-execute-core |

## 5. LLM 调用链 (核心)

```
agent_execute 工具
  │
  ▼
executeAgentTask(input)          ← agent-execute-core.js:448
  │
  ├─ [我们的路由块]              ← 如果 DEEPSEEK_API_KEY 存在 → 直接调 callDeepSeekMessages
  ├─ [我们的路由块]              ← 如果有兼容提供商 key → 直接调 callMultiProviderCompat
  │
  └─ callAnthropicMessages({...}) ← agent-execute-core.js:156 (兜底)
       │
       ├─ [我们的路由]            ← 检查 DEEPSEEK_API_KEY
       ├─ [我们的路由]            ← 检查 OpenAI-compat keys (Qwen/Kimi/...)
       ├─ OpenRouter 检查         ← 原始 upstream 逻辑
       ├─ Ollama Cloud 检查       ← 原始 upstream 逻辑
       └─ Anthropic API 调用      ← 原始 upstream 逻辑
```

### 另一个调用者: WASM Agent

```
agent-wasm.js:122
  │
  └─ callAnthropicMessages({...})  ← 直接调用 (绕过 executeAgentTask)
       │
       └─ 同样的路由逻辑 (DeepSeek → compat → OpenRouter → Ollama → Anthropic)
```

agent-wasm.js 有自己的 key 检查 (line 115):
```javascript
if (!process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  // 返回 echo stub
}
```

## 6. 各 LLM 函数签名

| 函数 | 参数 | API 格式 |
|------|------|---------|
| `callDeepSeekMessages(input)` | `{prompt, systemPrompt, model, apiKey, maxTokens, temperature, timeoutMs}` | Anthropic Messages 兼容 (`x-api-key` header) |
| `callMultiProviderCompat(input, compatProvider)` | `input` + `{baseURL, apiKey, name, chosenModel, ...}` | OpenAI Chat Completions (`Authorization: Bearer`) |
| `callAnthropicMessages(input)` | `{prompt, systemPrompt, model, maxTokens, temperature, timeoutMs}` | Anthropic Messages (`x-api-key` header) |
| `callOllamaCompat(input)` | `{prompt, systemPrompt, model, apiKey, ...}` | OpenAI Chat Completions |
| `callOpenAICompat(input)` | `{prompt, systemPrompt, model, apiKey, baseUrl, defaultModel, providerLabel, ...}` | OpenAI Chat Completions (OpenRouter) |

## 7. API Key 优先级

在 `callAnthropicMessages` 中的路由优先级:

```
1. DEEPSEEK_API_KEY (我们的 patch)
   条件: RUFLO_PROVIDER=deepseek 或 (RUFLO_PROVIDER 未设置 且 key 存在)

2. DASHSCOPE_API_KEY / MOONSHOT_API_KEY / ZHIPU_API_KEY / ARK_API_KEY (我们的 patch)
   条件: RUFLO_PROVIDER=<provider> 或 (RUFLO_PROVIDER 未设置 且 key 存在)
   取第一个找到的 key (按 qwen → kimi → zhipu → doubao 顺序)

3. OPENROUTER_API_KEY (原始 upstream)
   条件: RUFLO_PROVIDER=openrouter 或 (无 ANTHROPIC_API_KEY 且 key 存在)

4. OLLAMA_API_KEY (原始 upstream)
   条件: RUFLO_PROVIDER=ollama 或 (无 ANTHROPIC_API_KEY 且 key 存在 且 无 OpenRouter)

5. ANTHROPIC_API_KEY (原始 upstream)
   默认，所有 key 都没有时的兜底
```

---

## 8. setup.sh Patch 对照

### Step 6 — L1 Patch 注入点

| # | Patch 内容 | 注入位置 | 状态 |
|---|-----------|---------|------|
| 1 | Provider table + `findFirstOpenAICompatKey` + `resolveMultiProviderModel` | 文件顶部 (prepend) | ✅ |
| 2 | `callMultiProviderCompat(input, compatProvider)` | `export async function callAnthropicMessages` 之前 | ✅ 已修复命名冲突 |
| 3 | `callDeepSeekMessages(input)` | 同上 (插入顺序: 先 compat 后 deepseek) | ✅ |
| 4 | `callAnthropicMessages` 路由 | 函数体开头 (`{` 之后) | ✅ |
| 5 | `executeAgentTask` 变量声明 | 函数体开头 | ✅ |
| 6 | API key 检查修改 | `callAnthropicMessages` 体内 | ✅ |
| 7 | `executeAgentTask` 路由块 | `saveAgentStore(store)` 和 `callAnthropicMessages` 之间 | ✅ 已修复正则 |

### Step 8 — L2 Patch (agent-wasm.js)

| # | Patch 内容 | 状态 |
|---|-----------|------|
| 1 | `!process.env.ANTHROPIC_API_KEY` → 也接受 `DEEPSEEK_API_KEY` | ✅ |
| 2 | 错误信息更新 | ✅ |

### Step 11 — Index 注册

| # | Patch 内容 | 状态 |
|---|-----------|------|
| 1 | `localAgentTools` export 注册到 mcp-tools/index.js | ✅ |

### Step 13 — MCP Config 锁定

将 `.mcp.json` 中 `npx -y ruflo@latest mcp start` 替换为 `ruflo mcp start` (全局命令，可移植)

### Step 14 — 交互式 API Key 配置

用户选择 provider → 输入 key → 测试连通性 → 写入 `.mcp.json` env 字段

---

## 9. 已验证: Patch 间的依赖关系

```
callAnthropicMessages 路由
  ├─ 调用 callDeepSeekMessages     ← 在 Patch#3 注入
  └─ 调用 callMultiProviderCompat  ← 在 Patch#2 注入
       └─ 使用 findFirstOpenAICompatKey()  ← 在 Patch#1 注入

executeAgentTask 路由块
  ├─ 调用 callDeepSeekMessages     ← 同上
  ├─ 调用 callMultiProviderCompat  ← 同上
  └─ 调用 resolveMultiProviderModel ← 在 Patch#1 注入
```

所有依赖关系正确 — 被调用函数在调用者之前定义（函数声明会被 hoist）。

---

## 10. 未确定事项

1. **DeepSeek API 端点**: `https://api.deepseek.com/anthropic/v1/messages` — 需要确认这是 DeepSeek 的正确 Anthropic 兼容端点
2. **各 provider 的 model 名称**: `deepseek-v4-flash`, `qwen3.6-plus` 等 — 需要确认这些 model ID 在对应平台有效
