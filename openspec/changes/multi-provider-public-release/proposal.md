## Why

The multi-provider LLM support (DeepSeek, Qwen, Kimi, Zhipu, Doubao) has been verified working via npx cache patches, but the changes are fragile (lost on npm updates) and not portable. To distribute this as a usable fork on GitHub, all changes must be properly integrated into the source tree with clean setup for new users.

## What Changes

- **BREAKING**: Replace Anthropic-as-default with auto-detection of any configured LLM provider (DeepSeek > Chinese LLMs > Ollama > Anthropic)
- Add generic `OpenAICompatProvider` to `@claude-flow/providers` covering Qwen, Kimi, Zhipu, and Doubao
- Port multi-provider routing logic from patched npx cache into `agent-execute-core.ts` source
- Add `.mcp.json` for automatic MCP server setup on project open
- Add provider configuration documentation with API key setup guide
- Update `resolveAnthropicModel` to resolve models across all supported providers
- Keep existing `DeepSeekProvider` (Anthropic-compatible endpoint) unchanged

## Capabilities

### New Capabilities

- `multi-provider-routing`: Auto-detect available LLM provider from environment variables and route requests accordingly. Supports tiered priority: DeepSeek > Qwen > Kimi > Zhipu > Doubao > Ollama > Anthropic. Explicit override via `RUFLO_PROVIDER` env var.

- `openai-compat-provider`: Generic provider class for any OpenAI-compatible API endpoint. Accepts base URL, model mapping, and API key configuration. Covers Qwen (DashScope), Kimi (Moonshot), Zhipu (BigModel), Doubao (Ark/Volcengine).

- `zero-config-onboarding`: New users clone the repo, set one API key env var, and Claude Code auto-connects the MCP server via `.mcp.json`. No npm publishing required.

### Modified Capabilities

- `provider-manager`: Auto-detection logic extended from DeepSeek-only to all 5 Chinese providers plus Ollama
- `agent-execute-core`: LLM call routing now iterates provider table instead of hardcoded if/else chains

## Impact

- Source files: `v3/@claude-flow/providers/src/`, `v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts`, `v3/@claude-flow/integration/src/`
- New files: `.mcp.json` (project root), provider config constants
- No external dependency changes — all providers use standard `fetch` to their respective HTTP endpoints
- Build pipeline: CLI TypeScript compilation issues are pre-existing and scoped out of this change
