## Context

setup.sh Step 6 注入 Node.js patch 脚本到 `agent-execute-core.js`，Step 8 注入到 `agent-wasm.js`。测试发现 4 个 bug，均与 patch 代码的作用域、幂等性、文件发现逻辑有关。

当前 setup.sh 已修复 9 个已知问题（Bug #1-#8 加 WASM Fix 2 regex），但测试中暴露的问题需要进一步修改。

## Goals / Non-Goals

**Goals:**
- 修复 `const __hasOther` 重复声明（幂等检查缺失）
- 修复 `__useDS is not defined`（作用域变量名错误）
- 修复嵌套 `node_modules` 未 patch（单文件发现 → 多文件发现）
- 修复 WASM echo 检测不兼容对象返回值

**Non-Goals:**
- 不修改 Claude Code 的 MCP env 传递机制（#5）
- 不修改 statusline 面板逻辑（#8, #9）
- 不修改 `.mcp.json` 的生成方式（#1）

## Decisions

### Decision 1: `__hasOther` 幂等检查方式

选择：用 `code.includes("const __hasOther")` 包裹替换，而不是在 regex 加锚点。

原因：regex 锚点（如 `$`）在二次运行时可能因缩进变化失效。`includes` 检查语义明确 — "如果已经有 `__hasOther` 声明就不再注入"。

备选方案：在 `const anthropicKey` regex 加 `$(?! const __hasOther)` 负向前瞻。更精确但更脆弱，放弃。

### Decision 2: `__hasOther` 变量名适配

选择：将 `callAnthropicMessages` 中的 `__hasOther` 改用 `__deepseekKey || __compat`（该作用域已定义的变量）。

```
// 之前 (Bug #3): __useDS 和 __useCompat 在 callAnthropicMessages 中不存在
const __hasOther = __useDS || __useCompat || process.env.OLLAMA_API_KEY;

// 之后: 使用 callAnthropicMessages 作用域内的变量
const __hasOther = __deepseekKey || __compat || process.env.OLLAMA_API_KEY;
```

原因：`const anthropicKey` 只出现在 `callAnthropicMessages` 函数体内，替换只影响这个作用域。`__deepseekKey` 和 `__compat` 由我们的路由注入代码在同一函数体内声明，保证可用。

### Decision 3: 嵌套 node_modules 发现策略

选择：将 `find_target_file`（单文件）改为 `find` 返回所有匹配文件，逐个 patch。

路径查找优先级不变：`npm root -g` → `~/.nvm/...` → `/usr/local/...` → `~/.npm/_npx`。但在每个路径中不再 `head -1`，而是用 `find ... -type f` 返回全部。

排除规则：跳过 `~/.npm/_npx` 中的文件（这些是 npx 缓存，每次 `npx ruflo@latest` 可能生成新的，不应 patch）。

备选方案：遍历 node_modules 递归查找。但 `find -path` 模式已能精确匹配嵌套路径 `*/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js`。

### Decision 4: WASM echo 检测兼容方案

选择：添加对象格式兼容层，提取原始文本后再做 echo 判断。

```javascript
const rawResponse = typeof wasmResult === 'string'
  ? wasmResult
  : (wasmResult?.response ?? wasmResult?.text ?? '');
const isEchoStub = (rawResponse === `echo: ${input}` ||
  /^echo: /.test(rawResponse.slice(0, 12)));
```

返回时仍使用原始 `wasmResult` 拼接，保持与现有行为兼容。

## Risks / Trade-offs

- [多文件 patch 可能遗漏新路径] → 使用 `find -path` 模式匹配，覆盖所有已知路径
- [WASM 对象格式可能还有其他变体] → 使用 `?.response ?? .text ?? ''` 链式回退，覆盖常见格式
- [`__hasOther` 幂等检查可能误判] → 检查只针对字符串 `const __hasOther`，不是语义级检查，但足够防止重复注入
