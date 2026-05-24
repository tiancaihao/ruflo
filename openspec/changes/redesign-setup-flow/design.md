## Context

### ruflo MCP 启动流程（研究成果）

```
npx ruflo init --force
  → executor.js:writeMCPConfig()
    → 写入 项目/.mcp.json
    → MCP key: "ruflo"
    → 命令: npx -y ruflo@latest mcp start
    → env: CLAUDE_FLOW_MODE=v3, CLAUDE_FLOW_HOOKS_ENABLED=true, ...

Claude Code 启动时
  → 读取 .mcp.json
  → spawn: npx -y ruflo@latest mcp start
    → npx 在 ~/.npm/_npx/<hash>/ 中缓存最新版本
    → 运行 bin/mcp-server.js
    → 加载 dist/src/mcp-tools/agent-execute-core.js（LLM provider 路由逻辑）
```

### 关键约束

1. **npx cache 不稳定**：`npx -y ruflo@latest` 在 ruflo 发布新版本时解析到新 hash，patched 文件丢失
2. **MCP 配置位置**：`ruflo init` 写入**项目** `.mcp.json`，不是 `~/.claude.json`
3. **已有去重机制**：`executor.js:detectExistingRufloMCP()` 检查 `ruflo` key 是否已在 `.mcp.json`、`~/.claude.json`、`~/.claude/mcp.json` 或父目录 `.mcp.json` 中存在 → 如已存在则跳过写入
4. **API key 传递**：`.mcp.json` 的 `mcpServers.ruflo.env` 字段是标准方式，Claude Code 将其与继承环境合并后传给 MCP 进程

### 现有 setup.sh 的问题

| 问题 | 原因 |
|------|------|
| 两个 MCP server | setup.sh 写入 `~/.claude.json` 的 `claude-flow` key，与项目 `.mcp.json` 的 `ruflo` key 并存 |
| patch 丢失 | `.mcp.json` 仍用 `npx -y ruflo@latest`，版本更新/缓存清除后重新下载 |
| API key 传递复杂 | 之前用 bash -c wrapper，因 mktemp 错误等原因多次失败 |

## Goals / Non-Goals

**Goals:**
- setup.sh patch → 更新 `.mcp.json` command → API key 配置 一条龙流畅
- 锁定 MCP server 到 patched npx cache 路径，不受版本更新影响
- API key 通过 `.mcp.json` 的 `env` 字段传入
- 覆盖所有场景：未安装 ruflo、已安装、已 patch 过
- 幂等安全：多次运行不会产生重复 MCP entry

**Non-Goals:**
- 不修改 `~/.claude.json`（ruflo 相关）
- 不创建新的 MCP entry key
- 不自动修改 shell profile（`.zshrc` 等）
- 不处理 API key 的持久化存储（安全考虑）

## Decisions

### Decision 1: 更新已有 `.mcp.json` 而不是创建新的

**选择**: setup.sh 查找项目 `.mcp.json` 中的 `ruflo` key，更新其 `command` 和 `args`

**原因**:
- `npx ruflo init` 已经创建了正确的位置（项目 `.mcp.json`）
- 创建新 key 会导致两个 MCP server 同时运行
- 更新已有 entry 是最小侵入

**查找优先级**:
1. 项目 `.mcp.json` → `ruflo` key
2. 项目 `.mcp.json` → 其他 ruflo 相关 key (claude-flow)
3. `~/.claude.json` → `ruflo` key（用户级配置）

### Decision 2: 使用 `node` 锁定到 patched 路径

**选择**: 将 MCP 命令从 `npx -y ruflo@latest mcp start` 改为 `node <patched_npx_cache>/bin/mcp-server.js`

**原因**:
- 完全绕过 npx → 不受版本更新影响
- npx cache 路径是稳定的（只要不清理 npm cache）
- npx cache 中的 `bin/mcp-server.js` 经过 patch 后可直接使用

**备选方案**: 将 patched 文件复制到项目本地（如 `.claude/patched/`）→ 增加维护复杂度，且 ruflo 更新时用户需要手动重新 patch

### Decision 3: API key 通过 `env` 字段传入

**选择**: `.mcp.json` 的 `mcpServers.ruflo.env` 中添加 `PROVIDER_API_KEY=xxx`

**原因**:
- 这是 Claude Code MCP 的标准方式
- 环境变量注入到 MCP 进程，不污染全局环境
- 随項目隔离，不同项目可以用不同 key

**注意**: `env` 字段与原有 `CLAUDE_FLOW_MODE` 等 env 合并，不替换

### Decision 4: setup.sh 场景分支

```
开始
  │
  ├→ 检查 ruflo 是否已安装（npx cache 是否存在）
  │   ├→ 未安装 → npx ruflo init → 获得 npx cache
  │   └→ 已安装 → 使用已有 npx cache
  │
  ├→ Patch L1/L2/L3（幂等：检测已 patch → 跳过或覆盖）
  │
  ├→ 交互式 provider 选择 + API key 输入 + 连通性测试
  │
  ├→ 更新 .mcp.json（command → node, args → patched path, env → API key）
  │
  └→ 完成
```

### Decision 5: 非交互模式保留

**选择**: 检测 stdin 是 TTY 时进入交互模式；非 TTY 时跳过 provider 选择，打印手动配置指南

**原因**: CI/CD 或 pipe 环境中无法交互，但仍需完成 patch + MCP 锁定

## Risks / Trade-offs

- [Risk] 用户清理 npm cache (`npm cache clean --force`) → npx cache 目录删除 → MCP server 启动失败 → **Mitigation**: 启动时在 setup.sh 中记录警告信息，告知用户如果清理了 npm cache 需要重新运行 setup.sh
- [Risk] ruflo 大版本更新后 bin/mcp-server.js API 变更 → patched `agent-execute-core.js` 可能不兼容 → **Mitigation**: patch 前检查目标文件的结构特征（函数签名等），不匹配时报警
- [Risk] `.mcp.json` env 字段在旧版 Claude Code 中可能替换而非合并整个环境 → **Mitigation**: 如果测试发现在 macOS 上有问题，可回退到 bash -c wrapper 方案

## Open Questions

- `.mcp.json` 的 `env` 在 Claude Code 当前版本中是否正常 work？需要在用户机器上实际测试
- 如果用户清除了 npx cache 但保留了 `.mcp.json`，MCP server 将无法启动 → 是否需要自动检测并恢复？
