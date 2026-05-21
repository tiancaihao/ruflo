## ADDED Requirements

### Requirement: Auto-detect LLM provider from environment

The system SHALL detect available LLM providers by checking environment variables in priority order: `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY` (Qwen), `MOONSHOT_API_KEY` (Kimi), `ZHIPU_API_KEY` (GLM), `ARK_API_KEY` (Doubao), `OLLAMA_API_KEY`, `ANTHROPIC_API_KEY`. When an API key is found and a higher-priority provider is unavailable, the system SHALL route requests to that provider automatically.

#### Scenario: DeepSeek API key is set
- **WHEN** `DEEPSEEK_API_KEY` is set and `ANTHROPIC_API_KEY` is not
- **THEN** all LLM requests route to `https://api.deepseek.com/anthropic/v1/messages` with `x-api-key` auth and model `deepseek-v4-flash` (for sonnet-tier)

#### Scenario: Only Qwen API key is set
- **WHEN** `DASHSCOPE_API_KEY` is set and no other provider keys are set
- **THEN** all LLM requests route to `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` with `Authorization: Bearer` auth

#### Scenario: Multiple API keys set without explicit override
- **WHEN** both `DASHSCOPE_API_KEY` and `MOONSHOT_API_KEY` are set
- **THEN** Qwen is selected (higher priority in the fixed order)

### Requirement: Explicit provider override via environment variable

The system SHALL accept `RUFLO_PROVIDER` environment variable to override auto-detection. Valid values: `deepseek`, `qwen`, `kimi`, `zhipu`, `doubao`, `ollama`, `anthropic`.

#### Scenario: Explicit provider override
- **WHEN** `RUFLO_PROVIDER=kimi` and `MOONSHOT_API_KEY` is set
- **THEN** all LLM requests route to Kimi's API regardless of other available providers

#### Scenario: Explicit provider with missing key
- **WHEN** `RUFLO_PROVIDER=qwen` but `DASHSCOPE_API_KEY` is not set
- **THEN** the system falls through to auto-detection

### Requirement: Model tier mapping for each provider

The system SHALL map logical model tiers (`haiku`, `sonnet`/`inherit`, `opus`) to each provider's native model IDs according to the following table:

| Tier | DeepSeek | Qwen | Kimi | Zhipu | Doubao |
|------|----------|------|------|--------|--------|
| haiku | deepseek-v4-flash | qwen3.6-flash | kimi-k2-turbo-preview | GLM-4.7-Flash | doubao-lite-32k |
| sonnet/inherit | deepseek-v4-flash | qwen3.6-plus | kimi-k2.6 | GLM-5 | doubao-pro-32k |
| opus | deepseek-v4-pro | qwen3.6-max-preview | kimi-k2.6 | GLM-5.1 | doubao-pro-32k |

#### Scenario: Agent requests sonnet-tier model
- **WHEN** an agent spawns with `model: 'sonnet'` and DeepSeek is active
- **THEN** the system uses `deepseek-v4-flash` as the native model ID

#### Scenario: Agent requests opus-tier model with Qwen
- **WHEN** an agent spawns with `model: 'opus'` and Qwen is the auto-detected provider
- **THEN** the system uses `qwen3.6-max-preview` as the native model ID

### Requirement: Graceful fallback on provider error

The system SHALL return a structured error response with the provider name and HTTP status when an API call fails, rather than throwing an unhandled exception.

#### Scenario: Provider returns 401
- **WHEN** DeepSeek API returns HTTP 401
- **THEN** the system returns `{ success: false, model: 'deepseek-v4-flash', error: 'DeepSeek API error 401: ...' }`
