## Context

setup.sh 当前是一个无交互的 batch 脚本 — 检测 npx cache → 注入 patch → 输出提示信息。用户需要在脚本执行完毕后手动查阅终端输出，找到对应 provider 的环境变量名，自行配置 API key。这个"断点"导致：

1. 用户可能不知道各 provider 对应的环境变量名
2. API key 配置错误时没有即时反馈
3. 需要重启 Claude Code 才能验证配置是否正确

当前 setup.sh 的 Step 11 已经输出了所有 provider 环境变量提示，但这是被动的文档式提示，不是交互式引导。

## Goals / Non-Goals

**Goals:**
- setup.sh 所有 patch 完成后，自动进入交互式 provider 配置菜单
- 用户选择 provider → 输入 API key → 即时连通性测试
- 测试失败可重试（最多 3 次）或跳过
- 测试通过后提示 setup 成功

**Non-Goals:**
- 不自动修改 `.claude/settings.json`（避免破坏用户现有配置）
- 不保存 API key 到文件（安全考虑，用户自行管理环境变量）
- 不支持 OAuth/浏览器授权流程（仅 API key 方式）
- 不在 setup.sh 外部创建独立的配置向导

## Decisions

### Decision 1: 使用 bash `select` 而非自定义菜单

**选择**: `select` + `PS3` 实现菜单

**原因**:
- `select` 是 bash builtin，不需要 `tput` 或 `dialog`
- 自动处理输入校验（非数字输入重新提示）
- 兼容 macOS 默认 bash 和 Linux

**备选方案**:
- `dialog`/`whiptail` — 需要安装额外包，不是所有系统都有
- `tput` 光标控制 — 复杂且容易在不同终端出问题

### Decision 2: 使用 `curl` 测试连通性，而非真正调用 LLM

**选择**: `POST https://api.deepseek.com/v1/models` 等轻量 API，仅验证 auth header 是否被接受

**原因**:
- `/v1/models` 是 OpenAI-compatible API 的标准端点，几乎所有 provider 都支持
- 不会产生 token 费用
- 响应快速 (~200ms)，用户不用等待

**备选方案**:
- 调用 chat completions 发一条"hello" — 会产生费用，且慢
- DNS 解析 + TCP 连接测试 — 无法验证 API key

### Decision 3: API key 输入使用 `read -s` 隐藏回显

**选择**: `read -s -p "Enter API key: " APIKEY` — 输入时屏幕不显示

**原因**: 防止肩窥泄露，标准做法

### Decision 4: 最多 3 次重试，可跳过

**选择**: 循环计数器，3 次失败后提供 skip 选项

**原因**: 用户可能输错 key、provider 服务暂时不可用。给合理次数的重试机会，但也能跳过不阻塞 setup 完成。

### Decision 5: 不写入文件，仅输出环境变量设置命令

**选择**: 测试通过后打印 `export XXXX_API_KEY=...` 和环境变量示例

**原因**:
- 安全：不在磁盘上存储明文 API key
- 灵活性：用户可以选择配置到 shell profile、.claude/settings.json、或直接在当前 session 使用

## Risks / Trade-offs

- [Risk] provider API 的 `/v1/models` 端点可能不存在或返回不同状态码 → **Mitigation**: 接受 HTTP 200-299 和 401（key 有效但无权限）作为"连通性 OK"的判断；对已知 provider 的差异做特殊处理
- [Risk] curl 超时（网络问题）被误判为 key 错误 → **Mitigation**: 区分超时错误（提示网络问题）和 401 错误（提示 key 无效）
- [Risk] 非交互环境（CI/CD、pipe）中 select 循环行为异常 → **Mitigation**: 检测 `-t 1` (stdin 是否是 tty)，非 tty 时跳过交互菜单，打印当前提示信息后正常退出
