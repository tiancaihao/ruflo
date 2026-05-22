## 1. Layer 2: WASM Agent 修复

- [x] 1.1 `ruvector/agent-wasm.js`: 修改 `ANTHROPIC_API_KEY` 前置检查 (line 115-117)，添加 `DEEPSEEK_API_KEY` 条件
- [x] 1.2 `scripts/setup.sh`: 添加 Layer 2 修复 patch 注入语句 (Step 7)
- [ ] 1.3 验证: 设置 DEEPSEEK_API_KEY (无 ANTHROPIC_API_KEY) 后 `wasm_agent_*` 正常执行

## 2. Core Tool Loop — 基础

- [x] 2.1 定义 5 个工具 schema (read_file, write_file, edit_file, run_bash, list_files) 用 OpenAI function calling JSON Schema
- [x] 2.2 实现 `executeToolCall(toolName, args)` 分发器 + 白名单校验
- [x] 2.3 实现路径沙箱 (resolve → verify project root → reject traversal)
- [x] 2.4 `local-agent-loop.js`: 实现 `callAgentLoop(messages, options)` — while 循环: LLM → tool_calls → 执行 → 追加结果 → 继续
- [x] 2.5 集成现有 multi-provider 路由 (DeepSeek/Qwen provider dispatch + fetch)
- [x] 2.6 并行 tool 执行: 检测多个 tool_call → Promise.all 并发

## 3. Core Tool Loop — 长任务

- [x] 3.1 实现层次化上下文摘要: 每 5 轮触发一次，保留最近 5 轮原文
- [x] 3.2 摘要 LLM 调用 — 用 flash 模型，独立 fetch 调用
- [x] 3.3 实现原子 checkpoint 写入 (write-tmp → rename): messages[], turnCount, summary, toolResults
- [x] 3.4 实现 checkpoint 恢复: `local_agent_prompt` 检测已有 checkpoint → offer resume/reset/continue
- [x] 3.5 15 轮警告 / 50 轮硬上限 + token 预算保护 (50K chars)

## 4. Bash Tool 安全

- [x] 4.1 命令危险模式检测 (rm -rf, curl | bash, sudo, chmod 777, > /dev/sda, dd, mkfs, fork bomb)
- [x] 4.2 30s 默认超时 (child_process.exec + AbortSignal.timeout)
- [x] 4.3 stdout/stderr 分离，输出截断至 2000 字符

## 5. MCP Tool 集成: `local_agent_*`

- [x] 5.1 `src/local-agent-tools.js`: 创建 6 个 MCP 工具定义:
  - `local_agent_create` — 创建 agent 目录 + 初始化 checkpoint.json
  - `local_agent_prompt` — 核心: 调用 callAgentLoop，支持 `async: boolean`
  - `local_agent_status` — 读取 checkpoint.json 返回进度
  - `local_agent_events` — 读取 transcript.json 返回完整历史
  - `local_agent_list` — 列出 .claude-flow/agents/ 下所有 local agent
  - `local_agent_terminate` — 删除 agent 目录
- [x] 5.2 `mcp-tools/index.js`: 注册 localAgentTools (via setup.sh Step 10)
- [x] 5.3 异步后台模式: `async: true` → `local_agent_prompt` 立即返回 taskId，loop 在后台执行
- [x] 5.4 超时自动终止 (120s/轮, 50 轮上限)
- [x] 5.5 并发上限: `MAX_CONCURRENT_LOCAL_AGENTS` 环境变量 (默认 3)，超限返回 queued 状态
- [x] 5.6 向后兼容: 不加 `local_agent_*` 不影响现有 `managed_agent_*` 和 `agent_execute`

## 6. Setup Script 更新

- [x] 6.1 将 `local-agent-loop.js` + `local-agent-tools.js` 注入 setup.sh (Step 8, 9)
- [x] 6.2 注入 Layer 2 WASM Agent ANTHROPIC_API_KEY 前置拦截修复 (Step 7)
- [x] 6.3 更新 setup.sh 输出信息，提示 local_agent_* 新功能 (Step 11)

## 7. Provider 兼容性验证

- [ ] 7.1 DeepSeek: function calling + 并行 tool_call 测试
- [ ] 7.2 Qwen (DashScope): function calling 兼容性测试
- [ ] 7.3 摘要 LLM 调用在 flash 模型上的稳定性测试
- [ ] 7.4 回归: `agent_execute` 不加 enableTools 仍然正常
- [ ] 7.5 回归: `managed_agent_*` (有 ANTHROPIC_API_KEY 时) 仍然正常
- [ ] 7.6 Layer 2 回归: `wasm_agent_*` 仅 DEEPSEEK_API_KEY 时正常
