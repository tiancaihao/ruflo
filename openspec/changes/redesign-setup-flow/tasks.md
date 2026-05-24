## 1. Ruflo 检测与安装

- [x] 1.1 实现 `find_ruflo_cache()` 函数：搜索 `~/.npm/_npx/` 下的 ruflo npx cache，返回 `node_modules/@claude-flow/cli/bin/mcp-server.js` 存在的路径
- [x] 1.2 实现未安装检测：当 npx cache 中无 ruflo 时，自动执行 `npx -y ruflo@latest init --force` 并获取新 cache 路径
- [x] 1.3 区分全局 npm 安装 vs npx cache，优先使用 npx cache 路径

## 2. 幂等 Patch 系统

- [x] 2.1 提取 `find_target_file()`：在 npx cache 中搜索 `agent-execute-core.js`，按路径深度排序取最浅（避免嵌套 node_modules）
- [x] 2.2 实现 patch 标记检测：每个 patch (L1/L2/L3) 插入唯一标记字符串，后续检测到标记则跳过
- [x] 2.3 L1 patch（原 PROVIDER_TABLE/callOpenAICompat/callDeepSeekMessages/callAnthropicMessages/executeAgentTask/routing 插入）幂等化
- [x] 2.4 L2 patch（如果有）幂等化
- [x] 2.5 L3 patch（如果有）幂等化
- [ ] 2.6 目标文件结构校验：patch 前检查关键函数签名是否匹配预期，不匹配则报警退出

## 3. MCP 配置更新

- [x] 3.1 实现 `lock_mcp_config()` 函数：读取项目 `.mcp.json`，查找 `ruflo` 或 `claude-flow` key
- [x] 3.2 将 command 从 `npx` 改为 `node`，args 改为 `[<npx_cache>/bin/mcp-server.js]`
- [x] 3.3 保持已有 env 字段，追加 API key env var
- [x] 3.4 处理 fallback：项目 `.mcp.json` 无 ruflo key 时检查 `~/.claude.json`
- [x] 3.5 处理无 MCP 配置场景：创建新的 `.mcp.json`
- [x] 3.6 清理旧 `claude-flow` key（如果是从 legacy setup.sh 创建的）
- [x] 3.7 检测 command 是否已锁定到 `node`：如果是则只更新 API key

## 4. 交互式 Provider 配置

- [x] 4.1 实现 arrow-key 选择菜单（已有来自上个 change 的 Node.js 实现，复用并改进）
- [x] 4.2 实现 API key 隐藏输入 + 空值校验 + 重试
- [x] 4.3 实现 `test_connectivity(provider, apikey)`：POST/GET 对应 endpoint，区分 2xx/401/403/timeout
- [x] 4.4 实现重试/跳过逻辑（最多 3 次）
- [x] 4.5 测试通过后写入 API key 到 `.mcp.json` env 字段
- [x] 4.6 非 TTY 环境跳过交互，打印手动配置指南

## 5. 完整流程组装

- [x] 5.1 重写 setup.sh main flow：检测 → 安装(按需) → patch → MCP 锁定 → provider 配置
- [x] 5.2 确保所有步骤有清晰的状态输出（用户可看到进度）
- [x] 5.3 移除所有旧 `~/.claude.json` 写入逻辑

## 6. 验证与清理

- [ ] 6.1 测试场景 A：干净环境（无 ruflo）→ setup.sh 完整流程
- [x] 6.2 测试场景 B：已有 ruflo + .mcp.json → setup.sh patch + 更新
- [x] 6.3 测试场景 C：已有 patched 文件 → 幂等检测，跳过或覆盖
- [x] 6.4 测试场景 D：非交互模式（`echo "" | bash scripts/setup.sh`）→ 跳过菜单正常完成
- [x] 6.5 验证 MCP server 只有一个（无重复工具）
- [ ] 6.6 验证 API key 成功传递到 agent-execute-core.js 运行时（需要 Claude Code 重启 + 实际 key 测试）
