## Why

当前 setup.sh 完成所有 patch 注入后，用户需要手动查阅文档、找到对应 provider 的环境变量名、自行设置 API key、重启 Claude Code 后才能测试。这个"文档跳转 → 手动配置 → 重启 → 试错"的流程容易出错，尤其是新用户不清楚应该设哪个环境变量。在 setup 流程中直接提供交互式 provider 选择 + key 输入 + 连通性验证，可以将"安装完成到首次可用"的步骤从 4-5 步减少到 1 步。

## What Changes

- **新增**: setup.sh Step 11 之后加入交互式 provider 选择菜单（bash `select` 循环）
- **新增**: API key 输入提示（隐藏回显）
- **新增**: 连通性测试 — 向所选 provider 的 API endpoint 发送测试请求
- **新增**: 失败重试机制 — 最多 3 次，可选跳过
- **新增**: 测试通过后自动写入 `.claude/settings.json` MCP env 配置（可选）
- **变更**: setup.sh 从"一次性 patch 脚本"变为"patch + 引导式配置"的完整体验

## Capabilities

### New Capabilities

- `interactive-provider-setup`: setup.sh 执行完 patch 后提供交互式 provider 选择、API key 输入、连通性验证的菜单流程

### Modified Capabilities

<!-- None — 这是 setup.sh 新增的独立步骤，不修改现有 capabilities -->

## Impact

- `scripts/setup.sh`: 新增 ~80 行交互式菜单代码（Step 12）
- 需要了解各 provider 的 API 连通性测试 endpoint:
  - DeepSeek: `POST https://api.deepseek.com/v1/models` (list models)
  - Qwen/DashScope: `POST https://dashscope.aliyuncs.com/compatible-mode/v1/models`
  - Kimi/Moonshot: `POST https://api.moonshot.cn/v1/models`
  - Zhipu/BigModel: `POST https://open.bigmodel.cn/api/paas/v4/models`
  - Doubao/Ark: `POST https://ark.cn-beijing.volces.com/api/v3/models`
