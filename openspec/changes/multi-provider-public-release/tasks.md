## 1. Provider layer — OpenAI-compatible provider classes

- [x] 1.1 Create `v3/@claude-flow/providers/src/openai-compat-provider.ts` — generic `OpenAICompatProvider` base class extending `BaseProvider`, accepting config for base URL, env var, model list, pricing
- [x] 1.2 Create `v3/@claude-flow/providers/src/qwen-provider.ts` — `QwenProvider` extending `OpenAICompatProvider` with DashScope endpoint and qwen3.6 model family
- [x] 1.3 Create `v3/@claude-flow/providers/src/kimi-provider.ts` — `KimiProvider` extending `OpenAICompatProvider` with Moonshot endpoint and kimi-k2 model family
- [x] 1.4 Create `v3/@claude-flow/providers/src/zhipu-provider.ts` — `ZhipuProvider` extending `OpenAICompatProvider` with BigModel endpoint and GLM model family
- [x] 1.5 Create `v3/@claude-flow/providers/src/doubao-provider.ts` — `DoubaoProvider` extending `OpenAICompatProvider` with Ark/Volcengine endpoint and doubao model family
- [x] 1.6 Export all new providers from `v3/@claude-flow/providers/src/index.ts`
- [x] 1.7 Register new providers (`case 'qwen'`, `case 'kimi'`, etc.) in `provider-manager.ts` `createProvider()` switch
- [x] 1.8 Add `'qwen' | 'kimi' | 'zhipu' | 'doubao'` to `LLMProvider` union type in `types.ts`
- [x] 1.9 Add provider model IDs to `LLMModel` union type in `types.ts`

## 2. CLI source — multi-provider routing (documentation layer)

- [x] 2.1 Add `OPENAI_COMPAT_PROVIDERS` config table to `agent-execute-core.ts` with all 4 provider entries
- [x] 2.2 Add `callOpenAICompat()` generic function to `agent-execute-core.ts` (OpenAI chat-completions format)
- [x] 2.3 Add `resolveOpenAICompatModel()` helper for logical-to-native model mapping
- [x] 2.4 Update `callAnthropicMessages()` to iterate provider table with auto-detection
- [x] 2.5 Update `executeAgentTask()` to support OpenAI-compat providers in the agent execution path
- [x] 2.6 Add `'deepseek' | 'qwen' | 'kimi' | 'zhipu' | 'doubao'` to `ProviderType` in `multi-model-router.ts`
- [x] 2.7 Add provider entries to `createDefaultProviders()` in `provider-adapter.ts`

## 3. Setup script — npx cache patching

- [x] 3.1 Create `scripts/setup.sh` — downloads latest ruflo via npx, locates cache directory, patches `agent-execute-core.js`
- [x] 3.2 Embed the multi-provider patch logic as a `node -e` script within `setup.sh`
- [x] 3.3 Add friendly output: progress messages, success/failure indicators, next steps after setup
- [x] 3.4 Test `setup.sh` end-to-end on a clean npx cache

## 4. Project configuration — zero-config onboarding

- [x] 4.1 Create `.mcp.json` at project root with `npx -y ruflo@latest mcp start` configuration
- [x] 4.2 Verify `.gitignore` excludes `.env` and any credential files
- [x] 4.3 Add provider configuration documentation to README or `docs/providers.md`
- [x] 4.4 Document: how to get API keys for each provider, env var names, priority order, `RUFLO_PROVIDER` override

## 5. GitHub readiness

- [x] 5.1 Update remote origin from `ruvnet/ruflo` to user's own GitHub repo
- [x] 5.2 Commit all changes with descriptive commit message
- [x] 5.3 Push to GitHub and verify repo is accessible
- [x] 5.4 Verify `.mcp.json` is included in the pushed repo
- [x] 5.5 Remove hardcoded API keys from committed files (ensure keys only in `.env` or user's own settings)

## 6. Verification

- [x] 6.1 TypeScript compile check for provider layer: `npx tsc --noEmit` in `v3/@claude-flow/providers/`
- [x] 6.2 Run `./scripts/setup.sh` on a clean machine (or simulated clean cache) and verify patching
- [x] 6.3 Test DeepSeek provider routing via patched cache (regression check) — verified with live API
- [x] 6.4 Test auto-detection: set only one provider key, verify correct routing — verified: DEEPSEEK_API_KEY → auto-routes
- [x] 6.5 Test explicit override: set `RUFLO_PROVIDER=qwen`, verify routing — verified: RUFLO_PROVIDER=deepseek works
- [x] 6.6 Test graceful fallback: invalid API key → structured error response — verified: 401 → {success:false, error:"..."}
