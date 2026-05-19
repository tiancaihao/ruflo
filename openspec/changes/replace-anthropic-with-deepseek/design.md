## Context

ruflo uses a multi-provider architecture for LLM calls. The existing `AnthropicProvider` sends requests to `api.anthropic.com/v1/messages` using the Anthropic Messages API wire format. DeepSeek provides an Anthropic-compatible endpoint at `api.deepseek.com/anthropic/v1/messages` that accepts the same format with `x-api-key` auth — identical to Anthropic's protocol.

The existing provider ecosystem includes 3 layers:
1. **Core Provider** (`v3/@claude-flow/providers/`): `AnthropicProvider`, `OpenAIProvider`, `GoogleProvider`, etc. Managed by `ProviderManager` with load balancing and failover.
2. **Integration** (`v3/@claude-flow/integration/`): `MultiModelRouter` (cost-optimized routing) and `ProviderAdapter` (unified provider interface).
3. **Application** (`v3/@claude-flow/{mcp,plugins,cli}/`): MCP sampling, plugin provider registry, CLI provider management commands.

## Goals / Non-Goals

**Goals:**
- Create `DeepSeekProvider` as a first-class provider using DeepSeek's Anthropic-compatible endpoint
- Support `deepseek-v4-pro` (flagship) and `deepseek-v4-flash` (fast) models
- Make DeepSeek the default provider when `DEEPSEEK_API_KEY` is configured
- Register DeepSeek in all 3 layers so it's available in swarm agents, MCP sampling, and the plugin system
- Maintain full backward compatibility — existing Anthropic/OpenAI/Ollama providers continue working

**Non-Goals:**
- Does NOT modify Claude Code's own API calls (that's configured via `ANTHROPIC_BASE_URL` env var separately)
- Does NOT use DeepSeek's OpenAI-compatible endpoint (Anthropic-compatible is a better fit for ruflo's existing code)
- Does NOT remove or deprecate AnthropicProvider
- Does NOT add vision/image support (DeepSeek Anthropic endpoint doesn't support it)
- Does NOT handle the `thinking` parameter (DeepSeek accepts it but `budget_tokens` is ignored; ruflo doesn't use thinking mode)

## Decisions

### Decision 1: DeepSeekProvider extends Anthropic wire format

**Chose**: Build `DeepSeekProvider` based on `AnthropicProvider`'s request/response format (Messages API via `fetch`)

**Rationale**: DeepSeek's `/anthropic` endpoint uses identical wire format — same `/v1/messages` path, same `x-api-key` header, same request/response JSON shape, same SSE streaming format. The OpenAI-compatible endpoint would require mapping between Anthropic and OpenAI message formats, adding complexity for no benefit.

**Alternatives considered**:
- *Based on OpenAIProvider*: Would work (DeepSeek also has OpenAI-compat endpoint) but ruflo's agent layer and MCP sampling are built around Anthropic message format. Would need request/response translation layer.
- *Config-only approach (just change AnthropicProvider's baseUrl)*: Too fragile — doesn't handle model name differences, capability flags (no vision), or pricing differences between Anthropic and DeepSeek.

### Decision 2: Separate provider, not a configuration mode

**Chose**: Create a new `DeepSeekProvider` class rather than adding a `deepseek` mode flag to `AnthropicProvider`.

**Rationale**: Clear separation of concerns. Each provider owns its models, pricing, capabilities, and defaults. Adding a mode flag would complicate `AnthropicProvider` with conditional logic for model names, vision support, `top_k` handling, and pricing currency.

### Decision 3: Default provider precedence

**Chose**: When `DEEPSEEK_API_KEY` is set in environment, `ProviderManager` and `MultiModelRouter` default to DeepSeek. When absent, fall back to existing defaults (Anthropic if configured, else first available).

**Rationale**: Matches user's goal of "only configure DeepSeek API". No config file changes needed — environment variable presence drives default selection.

### Decision 4: Model mapping

**Chose**:
- `deepseek-v4-pro` → primary model (equivalent to Opus/Sonnet tier)
- `deepseek-v4-flash` → fast/cheap model (equivalent to Haiku tier, sub-agent default)

**Rationale**: Matches DeepSeek's official Claude Code integration recommendations. `v4-pro` has higher quality for complex agent reasoning; `v4-flash` is ~6x cheaper for bulk operations.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| DeepSeek Anthropic endpoint diverges from Anthropic spec | Streaming or tool calling breaks silently | Unit test with real API calls (auth via env var); `healthCheck()` validates connectivity |
| No vision support | Agents that pass images will fail | `capabilities.supportsVision` set to `false`; routing layer can fall back to Anthropic for vision tasks |
| `top_k` silently ignored | Temperature sampling behavior slightly different | Low impact — `top_k` is rarely the sole sampling parameter |
| Dynamic rate limiting (no fixed RPM) | Hard to predict concurrency limits | Use existing circuit breaker pattern; HTTP 429 handling from AnthropicProvider is inherited |
| CNY pricing | Cost tracking in USD may show minor rounding | Approximate USD conversion; DeepSeek costs are ~10x cheaper than Anthropic regardless |

## Open Questions

- Should `deepseek-v4-pro` or `deepseek-v4-flash` be the default model for agent tasks? (Pro: pro for quality, Flash: flash to match DeepSeek's Claude Code recommendation of flash for sub-agents)
- Confirm `anthropic-version: 2023-06-01` header is truly ignored (DeepSeek docs say yes)
