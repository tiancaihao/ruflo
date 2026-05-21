## Context

The ruflo codebase has a multi-layer LLM architecture:
- `@claude-flow/providers/` — formal provider classes (DeepSeekProvider, OpenAIProvider, etc.)
- `@claude-flow/cli/src/mcp-tools/agent-execute-core.ts` — the actual MCP LLM call path (direct `fetch` to API endpoints)
- `@claude-flow/mcp/src/sampling.ts` — MCP sampling protocol (separate LLM provider set)

Currently, only the npx cache (compiled `.js`) has multi-provider support. The source `.ts` files and proper provider classes need updating. Additionally, the CLI package has pre-existing TypeScript build errors, so source changes to CLI cannot be compiled.

**Constraint**: We cannot publish to the `@claude-flow` npm scope (no credentials). Build of `@claude-flow/cli` is blocked by pre-existing TS errors. The runtime mechanism must work with the npm-published `ruflo` package patched at install time.

## Goals / Non-Goals

**Goals:**
- Source-level provider code that documents the multi-provider architecture
- A one-command setup experience for new users (`./scripts/setup.sh`)
- `.mcp.json` for auto-detection by Claude Code on project open
- Support 5 Chinese LLM providers: DeepSeek, Qwen, Kimi, Zhipu, Doubao

**Non-Goals:**
- Fixing pre-existing CLI TypeScript build errors (out of scope, large effort)
- Publishing to npm (requires credentials we don't have)
- Adding tool calling support across providers (swarm uses text-only path)
- Baidu/ERNIE integration (non-OpenAI-compatible, different auth)

## Decisions

### 1. Runtime: npx cache patching via setup script

**Decision**: Ship a `scripts/setup.sh` that patches the npx cache's `agent-execute-core.js` with multi-provider support.

**Alternatives considered**:
- Publishing to npm: rejected, no credentials for `@claude-flow` scope
- Pointing MCP to local source: rejected, CLI can't be built
- Forking npm package: rejected, unnecessary complexity for initial release

### 2. Provider layer: Individual classes extend BaseProvider

**Decision**: Add `QwenProvider`, `KimiProvider`, `ZhipuProvider`, `DoubaoProvider` in `@claude-flow/providers/`, each extending `OpenAIProvider` with custom base URLs and model lists. Also add `OpenAICompatProvider` base class for future extension.

**Why not config table**: The existing pattern uses per-provider classes with consistent interface. A config table would diverge from this pattern and make the type system harder to maintain.

### 3. CLI layer: Config-table-based routing

**Decision**: In `agent-execute-core.ts`, use a config table (`OPENAI_COMPAT_PROVIDERS`) + generic `callOpenAICompat()` function. This mirrors the npx patch approach and keeps the file under 500 lines.

```typescript
// Concept (not exact implementation):
const OPENAI_COMPAT_PROVIDERS: Record<string, ProviderConfig> = {
  qwen:  { name: 'Qwen',  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', envKey: 'DASHSCOPE_API_KEY', ... },
  kimi:  { name: 'Kimi',  baseURL: 'https://api.moonshot.cn/v1',                    envKey: 'MOONSHOT_API_KEY',   ... },
  zhipu: { name: 'Zhipu', baseURL: 'https://open.bigmodel.cn/api/paas/v4',           envKey: 'ZHIPU_API_KEY',      ... },
  doubao:{ name: 'Doubao',baseURL: 'https://ark.cn-beijing.volces.com/api/v3',        envKey: 'ARK_API_KEY',        ... },
};
```

### 4. Provider auto-detection priority

**Decision**: DeepSeek > Qwen > Kimi > Zhipu > Doubao > Ollama > Anthropic

**Rationale**: DeepSeek uses Anthropic-compatible endpoint (native format, no translation). OpenAI-compat providers sorted by API quality/stability perception. Ollama before Anthropic to preserve existing fallback behavior. User can override with `RUFLO_PROVIDER=<name>`.

### 5. Model mapping: logical → native

| Logical | Qwen | Kimi | Zhipu | Doubao |
|---------|------|------|--------|--------|
| haiku | qwen3.6-flash | kimi-k2-turbo-preview | GLM-4.7-Flash | doubao-lite-32k |
| sonnet/inherit | qwen3.6-plus | kimi-k2.6 | GLM-5 | doubao-pro-32k |
| opus | qwen3.6-max-preview | kimi-k2.6 | GLM-5.1 | doubao-pro-32k |

**Rationale**: Maps agent model tiers (haiku=fast/cheap, sonnet=balanced, opus=best) to each provider's closest equivalent.

## Risks / Trade-offs

- **[Risk] npx cache version changes** → npx may download a new ruflo version, overwriting patches. Mitigation: setup script can be re-run. Long-term: fix CLI build and publish.
- **[Risk] API format changes** → Providers may change their endpoints or models. Mitigation: config table is central, easy to update.
- **[Trade-off] No TypeScript compilation for CLI** → Source changes to `agent-execute-core.ts` are documentation-only until build is fixed. The setup script patches the compiled `.js` directly.
- **[Risk] Thinking/reasoning tokens** → DeepSeek's thinking mode may consume output tokens. Mitigation: use `deepseek-v4-flash` for fast tasks, `deepseek-v4-pro` for complex reasoning.

## Migration Plan

1. Merge source changes to `v3/@claude-flow/providers/src/` (provider classes — compilable)
2. Merge source changes to `v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts` (documentation — not compilable)
3. Add `scripts/setup.sh` (auto-patches npx cache on user's machine)
4. Add `.mcp.json` (auto-detection by Claude Code)
5. Update README with setup instructions
6. Push to GitHub

**Rollback**: Delete npx cache (`rm -rf ~/.npm/_npx/*/node_modules/@claude-flow/`) and re-run `npx -y ruflo@latest`. The official version will be restored.

## Open Questions

- Should we attempt to fix CLI build errors to enable proper compilation? (estimated: 2-4 hours of TS fixes)
- Should we contact the ruflo maintainer about publishing under a community scope?
