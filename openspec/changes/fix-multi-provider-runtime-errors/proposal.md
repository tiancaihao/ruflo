## Why

setup.sh 的 multi-provider patch 在测试中暴露出 4 个运行时错误：重复变量声明导致 SyntaxError、作用域变量名错误导致 ReferenceError、嵌套 node_modules 未 patch 导致加载旧版代码、WASM echo 检测只处理 string 导致 LLM 回退被跳过。这些 bug 导致 patch 后的 ruflo 无法正常通过 DeepSeek API 工作。

## What Changes

- **修复 `const __hasOther` 重复声明**：添加幂等检查，防止 setup.sh 多次运行时叠加注入
- **修复 `__useDS is not defined`**：将 `callAnthropicMessages` 中的 `__hasOther` 变量引用从 `__useDS/__useCompat`（仅在 `executeAgentTask` 作用域存在）改为 `__deepseekKey/__compat`
- **修复嵌套 node_modules 未 patch**：`find_target_file` 改为查找所有副本（包括 `.../cli/node_modules/@claude-flow/cli/` 嵌套），全部 patch
- **修复 WASM echo 检测**：兼容 WASM 返回 `{response: "echo:..."}` 对象格式，不只是 `string`

## Capabilities

### New Capabilities

- `nested-node-modules-patch`: 自动发现并 patch `@claude-flow/cli` 的所有嵌套副本，确保无论 Node.js 解析到哪个副本都有 multi-provider 路由
- `wasm-object-echo-detection`: WASM agent echo 检测兼容对象和字符串两种返回值格式

### Modified Capabilities

<!-- None — no existing spec requirements change -->

## Impact

- `scripts/setup.sh` — Step 3 (npx cache), Step 4 (find_target_file), Step 6 (L1 patch regex), Step 8 (L2 WASM patch)
- 影响所有通过 curl-pipe-bash 或本地运行 setup.sh 的用户
