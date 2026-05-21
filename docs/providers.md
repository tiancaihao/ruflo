# Multi-Provider LLM Routing

Ruflo supports automatic routing to Chinese LLM providers. Set one environment variable and restart — no code changes needed.

## Supported Providers

| Provider | Env Variable | Base URL | API Protocol |
|----------|-------------|----------|--------------|
| **DeepSeek** | `DEEPSEEK_API_KEY` | `api.deepseek.com/anthropic/v1` | Anthropic Messages |
| **Qwen (DashScope)** | `DASHSCOPE_API_KEY` | `dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI Chat Completions |
| **Kimi (Moonshot)** | `MOONSHOT_API_KEY` | `api.moonshot.cn/v1` | OpenAI Chat Completions |
| **Zhipu (BigModel)** | `ZHIPU_API_KEY` | `open.bigmodel.cn/api/paas/v4` | OpenAI Chat Completions |
| **Doubao (Ark)** | `ARK_API_KEY` | `ark.cn-beijing.volces.com/api/v3` | OpenAI Chat Completions |

## Model Tier Mapping

Logical model tiers (haiku/sonnet/opus) are mapped to each provider's native models:

| Tier | DeepSeek | Qwen | Kimi | Zhipu | Doubao |
|------|----------|------|------|-------|--------|
| **Haiku** (fast) | deepseek-v4-flash | qwen3.6-flash | kimi-k2-turbo-preview | GLM-4.7-Flash | doubao-lite-32k |
| **Sonnet** (balanced) | deepseek-v4-flash | qwen3.6-plus | kimi-k2.6 | GLM-5 | doubao-pro-32k |
| **Opus** (best) | deepseek-v4-pro | qwen3.6-max-preview | kimi-k2.6 | GLM-5.1 | doubao-pro-32k |

## Auto-Detection Priority

When multiple keys are set, the router checks in this order:

1. **DeepSeek** (`DEEPSEEK_API_KEY`) — Anthropic-compatible, highest priority
2. **Qwen** (`DASHSCOPE_API_KEY`)
3. **Kimi** (`MOONSHOT_API_KEY`)
4. **Zhipu** (`ZHIPU_API_KEY`)
5. **Doubao** (`ARK_API_KEY`)
6. **Ollama** (`OLLAMA_API_KEY`)
7. **Anthropic** (`ANTHROPIC_API_KEY`) — default fallback

## Explicit Override

Set `RUFLO_PROVIDER` to force a specific provider:

```bash
export RUFLO_PROVIDER=qwen      # Force Qwen
export RUFLO_PROVIDER=deepseek  # Force DeepSeek
export RUFLO_PROVIDER=kimi      # Force Kimi
```

## How to Get API Keys

- **DeepSeek**: https://platform.deepseek.com/api_keys
- **Qwen (DashScope)**: https://dashscope.console.aliyun.com/apiKey
- **Kimi (Moonshot)**: https://platform.moonshot.cn/console/api-keys
- **Zhipu (BigModel)**: https://open.bigmodel.cn/usercenter/apikeys
- **Doubao (Ark)**: https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey

## Configuration in Claude Code

### Option A: `.claude/settings.json` (recommended)

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "ruflo@latest", "mcp", "start"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-your-key-here"
      }
    }
  }
}
```

### Option B: `.mcp.json` at project root

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "ruflo@latest", "mcp", "start"]
    }
  }
}
```

Then set `DEEPSEEK_API_KEY` (or any provider key) as a shell environment variable.

## One-Command Setup

```bash
./scripts/setup.sh
```

This downloads the latest ruflo and patches the npx cache with multi-provider routing. After setup, set your API key and restart Claude Code.

## Graceful Fallback

If a provider call fails (invalid key, timeout, server error), the router returns a structured error response. The caller receives `{ success: false, error: "..." }` instead of crashing.
