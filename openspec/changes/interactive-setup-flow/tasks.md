## 1. Provider 信息表

- [x] 1.1 定义 PROVIDERS 关联数组（name → env_var + test_endpoint），在 setup.sh Step 12 之前插入

## 2. 交互式菜单

- [x] 2.1 实现 `select` 循环：展示 provider 选项、读取用户选择
- [x] 2.2 实现 TTY 检测：`[ -t 0 ]` 判断是否交互环境，非交互时跳过并打印手动配置指南

## 3. API Key 输入

- [x] 3.1 实现 `read -s` 隐藏输入 + 空值校验 + 重新提示
- [x] 3.2 provider 选中后打印对应的环境变量名，让用户知道该填什么

## 4. 连通性测试

- [x] 4.1 实现 `test_connectivity(provider, apikey)` 函数：curl POST 到对应 endpoint
- [x] 4.2 HTTP 2xx → 成功；HTTP 401 → "key 无效"；其他/超时 → "网络错误"
- [x] 4.3 超时 10 秒，打印 curl 实际返回值用于调试

## 5. 重试/跳过逻辑

- [x] 5.1 实现重试计数器（最多 3 次），失败后显示"重试 / 跳过 / 退出"选项
- [x] 5.2 跳过时打印手动配置说明并正常退出；退出时返回非零码
- [x] 5.3 3 次均失败后自动打印完整配置指南

## 6. 成功输出

- [x] 6.1 测试通过后打印 `export <ENV_VAR>=...` 供用户复制
- [x] 6.2 打印 Claude Code settings.json MCP env 配置示例

## 7. 验证

- [ ] 7.1 交互模式：运行 setup.sh 确认菜单出现，选择 provider 后输入 key 可测试
- [x] 7.2 非交互模式：`echo "" | bash scripts/setup.sh` 确认跳过菜单正常完成
- [x] 7.3 错误处理：输入错误 key → 3 次重试 → 自动跳过
