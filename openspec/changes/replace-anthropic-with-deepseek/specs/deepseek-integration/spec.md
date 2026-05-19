## ADDED Requirements

### Requirement: DeepSeek registered in ProviderManager
The `ProviderManager` SHALL support `'deepseek'` as a valid provider type.

#### Scenario: Create DeepSeek provider via manager
- **WHEN** `ProviderManager` receives config with `provider: 'deepseek'`
- **THEN** a `DeepSeekProvider` instance is created and initialized

#### Scenario: DeepSeek as default when API key present
- **WHEN** `DEEPSEEK_API_KEY` environment variable is set and no explicit default provider is configured
- **THEN** DeepSeek is selected as the default provider for requests

### Requirement: DeepSeek in MultiModelRouter
The `MultiModelRouter` SHALL include DeepSeek as a native `ProviderType` with DeepSeek model definitions.

#### Scenario: DeepSeek provider type recognized
- **WHEN** `MultiModelRouter` is initialized
- **THEN** `'deepseek'` is a valid value in the `ProviderType` union and provider health tracking

#### Scenario: DeepSeek models in router catalog
- **WHEN** `getModels()` is called
- **THEN** the result includes `deepseek-v4-pro` and `deepseek-v4-flash` with correct capabilities, pricing, and latency estimates

#### Scenario: Cost-optimized routing to DeepSeek
- **WHEN** routing mode is `'cost-optimized'` and DeepSeek is available
- **THEN** DeepSeek models rank higher than Anthropic models due to lower per-token cost

### Requirement: DeepSeek in ProviderAdapter defaults
The `ProviderAdapter` SHALL include DeepSeek in `createDefaultProviders()`.

#### Scenario: Default providers include DeepSeek
- **WHEN** `createDefaultProviders()` is called
- **THEN** the result includes a DeepSeek provider entry with `deepseek-v4-pro` and `deepseek-v4-flash` models

### Requirement: DeepSeek in MCP SamplingManager
The MCP `SamplingManager` SHALL support creating DeepSeek-backed LLM providers via a factory function.

#### Scenario: Create DeepSeek sampling provider
- **WHEN** `createDeepSeekProvider(apiKey)` is called with a valid API key
- **THEN** an `LLMProvider` is returned with `name: 'deepseek'` that sends requests to `api.deepseek.com/anthropic/v1/messages`

#### Scenario: DeepSeek sampling provider unavailable without key
- **WHEN** `createDeepSeekProvider('')` is called with an empty API key
- **THEN** the provider's `isAvailable()` returns `false`

### Requirement: DeepSeek in Plugin ProviderFactory
The `ProviderFactory` SHALL provide a `createDeepSeek()` static method.

#### Scenario: Create DeepSeek plugin definition
- **WHEN** `ProviderFactory.createDeepSeek()` is called
- **THEN** an `LLMProviderDefinition` is returned with `name: 'deepseek'`, `models` containing `deepseek-v4-pro` and `deepseek-v4-flash`, and capabilities including `completion`, `chat`, `streaming`, `function-calling`, `code-generation`

### Requirement: DeepSeek in CLI provider commands
The CLI `providers` command SHALL recognize DeepSeek as a supported provider.

#### Scenario: DeepSeek in provider catalog
- **WHEN** `claude-flow providers list` is executed
- **THEN** DeepSeek appears in the provider listing with models `deepseek-v4-pro, deepseek-v4-flash`

#### Scenario: DeepSeek API key resolution
- **WHEN** CLI resolves API key for `deepseek` provider
- **THEN** it checks both the config file and the `DEEPSEEK_API_KEY` environment variable

#### Scenario: DeepSeek connectivity test
- **WHEN** `claude-flow providers test -p deepseek` is executed
- **THEN** the CLI sends a test request to `https://api.deepseek.com/anthropic/v1/messages` with `x-api-key` auth

### Requirement: Environment variable configuration
The system SHALL recognize `DEEPSEEK_API_KEY` as the primary environment variable for DeepSeek API authentication.

#### Scenario: DeepSeek API key from environment
- **WHEN** `DEEPSEEK_API_KEY` is set to a valid key
- **THEN** DeepSeekProvider uses it for authentication without requiring config file changes

#### Scenario: Fallback auth token
- **WHEN** `DEEPSEEK_API_KEY` is not set but `ANTHROPIC_AUTH_TOKEN` is set
- **THEN** DeepSeekProvider uses `ANTHROPIC_AUTH_TOKEN` as a fallback (matching DeepSeek's Claude Code integration pattern)

### Requirement: Backward compatibility
Existing providers SHALL continue to function when DeepSeek support is added.

#### Scenario: Anthropic provider unchanged
- **WHEN** the system has an Anthropic API key configured and DeepSeek is not configured
- **THEN** requests route to Anthropic exactly as before the change

#### Scenario: Fallback chain intact
- **WHEN** DeepSeek is unavailable and fallback is enabled
- **THEN** ProviderManager falls back to the next available provider in the configured chain
