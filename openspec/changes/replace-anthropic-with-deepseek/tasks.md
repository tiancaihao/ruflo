## 1. Type system changes

- [ ] 1.1 Add `'deepseek'` to `LLMProvider` union type in `v3/@claude-flow/providers/src/types.ts`
- [ ] 1.2 Add `'deepseek-v4-pro'` and `'deepseek-v4-flash'` to `LLMModel` union type

## 2. DeepSeekProvider implementation

- [ ] 2.1 Create `v3/@claude-flow/providers/src/deepseek-provider.ts` based on `AnthropicProvider`
- [ ] 2.2 Configure base URL to `https://api.deepseek.com/anthropic` and `x-api-key` auth
- [ ] 2.3 Define supported models: `deepseek-v4-pro`, `deepseek-v4-flash`
- [ ] 2.4 Set capabilities: 1M context, 384K max output, streaming/tools=yes, vision=no
- [ ] 2.5 Set pricing (CNY per 1M tokens with approximate USD conversion)
- [ ] 2.6 Implement `doInitialize()` with `DEEPSEEK_API_KEY` env var support
- [ ] 2.7 Implement `doComplete()` using Anthropic Messages wire format
- [ ] 2.8 Implement `doStreamComplete()` with SSE parsing
- [ ] 2.9 Implement `listModels()`, `getModelInfo()`, `doHealthCheck()`
- [ ] 2.10 Handle error responses: 401 → AuthenticationError, 429 → RateLimitError, 5xx → retryable LLMProviderError

## 3. Provider registration

- [ ] 3.1 Export `DeepSeekProvider` from `v3/@claude-flow/providers/src/index.ts`
- [ ] 3.2 Add `case 'deepseek'` in `ProviderManager.createProvider()` switch statement
- [ ] 3.3 Import `DeepSeekProvider` in `provider-manager.ts`

## 4. Integration layer

- [ ] 4.1 Add `'deepseek'` to `ProviderType` union in `multi-model-router.ts`
- [ ] 4.2 Add DeepSeek model entries (`deepseek-v4-pro`, `deepseek-v4-flash`) to `DEFAULT_MODELS` array
- [ ] 4.3 Initialize `'deepseek'` in provider health tracking
- [ ] 4.4 Add `'deepseek'` to `ProviderType` union in `provider-adapter.ts`
- [ ] 4.5 Add DeepSeek provider to `createDefaultProviders()` with full model definitions

## 5. MCP Sampling

- [ ] 5.1 Create `createDeepSeekProvider()` factory function in `v3/@claude-flow/mcp/src/sampling.ts`
- [ ] 5.2 Configure Anthropic-compatible endpoint and `x-api-key` auth in the sampling provider

## 6. Plugin provider factory

- [ ] 6.1 Add `createDeepSeek()` static method to `ProviderFactory` in `plugins/src/providers/index.ts`
- [ ] 6.2 Set display name, models, capabilities, rate limits, and cost in the definition

## 7. CLI provider commands

- [ ] 7.1 Add DeepSeek entry to `PROVIDER_CATALOG` array with `DEEPSEEK_API_KEY` env var
- [ ] 7.2 Add `deepseek` to `envMapping` in `resolveApiKey()` function
- [ ] 7.3 Add DeepSeek test endpoint to `testProviderConnectivity()` (Anthropic-compatible endpoint with `x-api-key`)
- [ ] 7.4 Add DeepSeek models to the models table in `modelsCommand`

## 8. Configuration and defaults

- [ ] 8.1 Add `deepseek` entry to provider config map in `hooks/src/llm/llm-hooks.ts`
- [ ] 8.2 Set DeepSeek as default provider when `DEEPSEEK_API_KEY` env var is present

## 9. Verification

- [ ] 9.1 Verify TypeScript compilation: `npx tsc --noEmit` in `v3/` directory
- [ ] 9.2 Run existing provider tests to confirm no regressions
- [ ] 9.3 Manually test DeepSeek provider connectivity with a valid API key via `healthCheck()`
- [ ] 9.4 Test `ProviderManager` with `provider: 'deepseek'` config selects DeepSeek provider
- [ ] 9.5 Test fallback: DeepSeek unavailable → falls back to next provider
