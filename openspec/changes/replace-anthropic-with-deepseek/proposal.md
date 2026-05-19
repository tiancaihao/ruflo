## Why

Fork ruvnet/ruflo to replace Anthropic API as the default LLM backend with DeepSeek API. This allows running ruflo's full agent orchestration capabilities (agent swarms, MCP sampling, plugin providers) using only a DeepSeek API key — significantly reducing costs while retaining functionality. DeepSeek provides an Anthropic-compatible API endpoint (`api.deepseek.com/anthropic`) that accepts the same Messages API wire format ruflo's AnthropicProvider already uses, making the integration a targeted change rather than a rewrite.

## What Changes

- **Create `DeepSeekProvider`** — new provider class in `v3/@claude-flow/providers/src/` based on AnthropicProvider, using DeepSeek's Anthropic-compatible endpoint (`api.deepseek.com/anthropic/v1/messages`)
- **Add `'deepseek'` to type system** — extend `LLMProvider` union, `LLMModel` union, and `ProviderType` unions across the codebase
- **Register DeepSeek as default** — update `ProviderManager`, `MultiModelRouter`, `ProviderAdapter`, and CLI defaults to prefer DeepSeek
- **Add DeepSeek to MCP sampling** — create `createDeepSeekProvider()` function for server-initiated LLM calls
- **Add DeepSeek to Plugin layer** — extend `ProviderFactory` with `createDeepSeek()` static method
- **Update CLI** — add DeepSeek to provider catalog, environment variable mappings (`DEEPSEEK_API_KEY`), and connectivity test endpoints
- **Model support**: `deepseek-v4-pro` (flagship) and `deepseek-v4-flash` (fast/cheap), both with 1M context window and 384K max output tokens
- **Capabilities**: streaming, tool/function calling, system messages, thinking mode, JSON output. Vision is explicitly NOT supported.

## Capabilities

### New Capabilities
- `deepseek-provider`: Core DeepSeek LLM provider — implements the ILLMProvider interface, handles Anthropic-compatible wire format to `api.deepseek.com/anthropic`, manages DeepSeek-specific models, pricing, and capability flags
- `deepseek-integration`: Full-system integration — registers DeepSeek in ProviderManager, MultiModelRouter, ProviderAdapter, MCP SamplingManager, Plugin ProviderFactory, and CLI provider commands. Sets DeepSeek as the default provider when configured.

### Modified Capabilities
<!-- No existing capabilities to modify — greenfield fork -->

## Impact

- **New file**: `v3/@claude-flow/providers/src/deepseek-provider.ts` (~400 lines, port of AnthropicProvider)
- **Modified files** (9): `types.ts`, `index.ts`, `provider-manager.ts`, `multi-model-router.ts`, `provider-adapter.ts`, `sampling.ts`, `plugins/src/providers/index.ts`, `cli/src/commands/providers.ts`, `hooks/src/llm/llm-hooks.ts`
- **Environment variable**: new `DEEPSEEK_API_KEY` recognized alongside existing `ANTHROPIC_API_KEY`
- **No breaking changes**: existing Anthropic, OpenAI, Ollama providers continue to work. DeepSeek is added as a new option and set as default when its API key is present.
