## ADDED Requirements

### Requirement: OpenAICompatProvider base class

The system SHALL provide an `OpenAICompatProvider` class in `@claude-flow/providers/` that accepts configuration for base URL, API key environment variable, model list, and pricing. This class SHALL implement the `ILLMProvider` interface following the same patterns as the existing `OpenAIProvider`.

#### Scenario: Provider initialization with config
- **WHEN** `QwenProvider` is instantiated with `{ apiKey: 'sk-xxx' }`
- **THEN** the provider sets its base URL to `https://dashscope.aliyuncs.com/compatible-mode/v1` and uses `Authorization: Bearer` auth header

#### Scenario: Model listing
- **WHEN** `listModels()` is called on a configured OpenAI compat provider
- **THEN** the provider returns its supported model IDs (e.g., `['qwen3.6-flash', 'qwen3.6-plus', 'qwen3.6-max-preview']`)

### Requirement: Per-provider model definitions

Each provider class SHALL define its supported models with accurate context window sizes, max output tokens, capabilities, and pricing.

| Provider | Flagship Model | Flash Model | Context | Max Output |
|----------|---------------|-------------|---------|------------|
| Qwen | qwen3.6-max-preview | qwen3.6-flash | 128K | 8K |
| Kimi | kimi-k2.6 | kimi-k2-turbo-preview | 128K | 8K |
| Zhipu | GLM-5.1 | GLM-4.7-Flash | 128K | 8K |
| Doubao | doubao-pro-32k | doubao-lite-32k | 32K | 4K |

#### Scenario: Get model info for Qwen flagship
- **WHEN** `getModelInfo('qwen3.6-max-preview')` is called
- **THEN** the response includes `contextLength: 131072` and `supportsStreaming: true`

### Requirement: Provider health check

Each OpenAI-compatible provider SHALL implement `doHealthCheck()` by calling the models list endpoint at its configured base URL.

#### Scenario: Successful health check
- **WHEN** the provider's API endpoint returns 200 for the models request
- **THEN** `healthCheck()` returns `{ available: true }`

#### Scenario: Failed health check
- **WHEN** the provider's API endpoint returns an error
- **THEN** `healthCheck()` returns `{ available: false, error: '...' }`

### Requirement: Provider registration in ProviderManager

The `ProviderManager` SHALL support creating instances of QwenProvider, KimiProvider, ZhipuProvider, and DoubaoProvider via the `createProvider()` switch statement.

#### Scenario: ProviderManager creates Qwen provider
- **WHEN** `ProviderManager.createProvider({ provider: 'qwen', apiKey: 'sk-xxx' })` is called
- **THEN** a `QwenProvider` instance is returned
