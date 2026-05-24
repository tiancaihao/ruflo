## Why

当前 setup.sh 经过多次修补，存在以下结构性问题：

1. **MCP 配置重复**：setup.sh 写入 `~/.claude.json` 创建一个新 MCP entry，而 `npx ruflo init` 已在项目 `.mcp.json` 创建了 `ruflo` entry，导致两个 MCP server 同时启动、产生 250+ 重复工具
2. **npx cache 不稳定**：MCP 命令仍是 `npx -y ruflo@latest mcp start`，当 ruflo 发布新版本或 npx cache 过期时，重新下载后 patch 全部丢失
3. **API key 存放不明确**：之前尝试了 env、bash -c wrapper 等多种方式，始终没有正确传递给 MCP server
4. **场景覆盖不全**：未系统考虑"已安装 ruflo / 未安装 ruflo / 已 patch 过"等状态

需要从头梳理流程，重新设计 setup.sh 的 patch → MCP 更新 → API key 配置链路。

## What Changes

- **重新设计 setup.sh 整体流程**：明确步骤边界和每个步骤的前置条件、幂等性保证
- **MCP 配置策略变更**：不再创建新的 MCP entry，而是**更新已有 `.mcp.json`** 中的 command（从 `npx` 改为 `node` + patched path 锁定）
- **API key 存放方案**：使用 `.mcp.json` 的 `env` 字段传入 API key
- **覆盖所有场景**：未安装 ruflo → 先 `npx ruflo init` 再 patch、已安装 ruflo → 直接 patch 覆盖、已 patch 过 → 检测并跳过或覆盖
- **BREAKING**: 移除之前向 `~/.claude.json` 写入 MCP 配置的逻辑

## Capabilities

### New Capabilities

- `unified-setup-flow`: 重新设计的 setup.sh，覆盖全场景（未安装/已安装/已 patch），正确管理 MCP 配置，API key 可靠传递给 MCP server

### Modified Capabilities

<!-- 这是全新的 change，不修改现有 specs -->

## Impact

- `scripts/setup.sh`: 全面重写流程控制、MCP 配置更新逻辑
- `.mcp.json`: setup.sh 会修改此文件（command 从 npx 改为 node + patched path）
- 不再修改 `~/.claude.json`
