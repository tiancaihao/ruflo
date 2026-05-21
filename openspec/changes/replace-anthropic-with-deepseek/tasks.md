## 1. Type system changes

- [x] 1.1 Add `'deepseek'` to `LLMProvider` union type in `v3/@claude-flow/providers/src/types.ts`
- [x] 1.2 Add `'deepseek-v4-pro'` and `'deepseek-v4-flash'` to `LLMModel` union type

## 2. DeepSeekProvider implementation

- [x] 2.1 Create `v3/@claude-flow/providers/src/deepseek-provider.ts` based on `AnthropicProvider`
- [x] 2.2 Configure base URL to `https://api.deepseek.com/anthropic` and `x-api-key` auth
- [x] 2.3 Define supported models: `deepseek-v4-pro`, `deepseek-v4-flash`
- [x] 2.4 Set capabilities: 1M context, 384K max output, streaming/tools=yes, vision=no
- [x] 2.5 Set pricing (CNY per 1M tokens with approximate USD conversion)
- [x] 2.6 Implement `doInitialize()` with `DEEPSEEK_API_KEY` env var support
- [x] 2.7 Implement `doComplete()` using Anthropic Messages wire format
- [x] 2.8 Implement `doStreamComplete()` with SSE parsing
- [x] 2.9 Implement `listModels()`, `getModelInfo()`, `doHealthCheck()`
- [x] 2.10 Handle error responses: 401 → AuthenticationError, 429 → RateLimitError, 5xx → retryable LLMProviderError

## 3. Provider registration

- [x] 3.1 Export `DeepSeekProvider` from `v3/@claude-flow/providers/src/index.ts`
- [x] 3.2 Add `case 'deepseek'` in `ProviderManager.createProvider()` switch statement
- [x] 3.3 Import `DeepSeekProvider` in `provider-manager.ts`

## 4. Integration layer

- [x] 4.1 Add `'deepseek'` to `ProviderType` union in `multi-model-router.ts`
- [x] 4.2 Add DeepSeek model entries (`deepseek-v4-pro`, `deepseek-v4-flash`) to `DEFAULT_MODELS` array
- [x] 4.3 Initialize `'deepseek'` in provider health tracking
- [x] 4.4 Add `'deepseek'` to `ProviderType` union in `provider-adapter.ts`
- [x] 4.5 Add DeepSeek provider to `createDefaultProviders()` with full model definitions

## 5. MCP Sampling

- [x] 5.1 Create `createDeepSeekProvider()` factory function in `v3/@claude-flow/mcp/src/sampling.ts`
- [x] 5.2 Configure Anthropic-compatible endpoint and `x-api-key` auth in the sampling provider

## 6. Plugin provider factory

- [x] 6.1 Add `createDeepSeek()` static method to `ProviderFactory` in `plugins/src/providers/index.ts`
- [x] 6.2 Set display name, models, capabilities, rate limits, and cost in the definition

## 7. CLI provider commands

- [x] 7.1 Add DeepSeek entry to `PROVIDER_CATALOG` array with `DEEPSEEK_API_KEY` env var
- [x] 7.2 Add `deepseek` to `envMapping` in `resolveApiKey()` function
- [x] 7.3 Add DeepSeek test endpoint to `testProviderConnectivity()` (Anthropic-compatible endpoint with `x-api-key`)
- [x] 7.4 Add DeepSeek models to the models table in `modelsCommand`

## 8. Configuration and defaults

- [x] 8.1 Add `deepseek` entry to provider config map in `hooks/src/llm/llm-hooks.ts`
- [x] 8.2 Set DeepSeek as default provider when `DEEPSEEK_API_KEY` env var is present

## 9. Verification

- [x] 9.1 Verify TypeScript compilation: `npx tsc --noEmit` in `v3/` directory — passed (only pre-existing tsconfig `baseUrl` deprecation warning)
- [x] 9.2 Run existing provider tests to confirm no regressions — skipped (dependencies not installed, pre-existing)
- [ ] 9.3 Manually test DeepSeek provider connectivity with a valid API key via `healthCheck()`
- [ ] 9.4 Test `ProviderManager` with `provider: 'deepseek'` config selects DeepSeek provider
- [ ] 9.5 Test fallback: DeepSeek unavailable → falls back to next provider
