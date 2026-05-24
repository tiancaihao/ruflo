## 1. Fix `const __hasOther` duplicate declaration (Bug #2)

- [x] 1.1 Add idempotent check `if (!code.includes("const __hasOther"))` around the `const anthropicKey` replacement in L1 patch script
- [x] 1.2 Verify second run of setup.sh does not create duplicate `const __hasOther`

## 2. Fix `__useDS is not defined` in callAnthropicMessages (Bug #3)

- [x] 2.1 Change `__hasOther` variable reference from `__useDS || __useCompat` to `__deepseekKey || __compat` in `const anthropicKey` replacement
- [x] 2.2 Verify `callAnthropicMessages` can route to DeepSeek when `DEEPSEEK_API_KEY` is set and `ANTHROPIC_API_KEY` is not

## 3. Patch nested node_modules copies (Bug #4, #6)

- [x] 3.1 Modify `find_target_file` to return ALL matching files instead of first match (`find ... -type f` without `head -1`)
- [x] 3.2 Loop through all discovered target files in Step 6 (L1) and Step 8 (L2), applying patches to each
- [x] 3.3 Keep npx cache exclusion (delete stale caches, don't patch them)
- [x] 3.4 Verify nested `.../cli/node_modules/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js` is patched

## 4. Fix WASM echo detection for object return format (Bug #7)

- [x] 4.1 Add object format compatibility in Step 8 (L2 WASM patch): extract `rawResponse` from `wasmResult.response` or `wasmResult.text` fallback
- [x] 4.2 Use `rawResponse` for echo pattern matching instead of `wasmResult` directly
- [ ] 4.3 Verify `wasm_agent_prompt` routes through LLM when WASM returns `{response: "echo: ..."}`

## 5. Verification

- [x] 5.1 Run setup.sh twice on clean install, verify no SyntaxError from duplicate declarations
- [ ] 5.2 Verify `agent_execute` works with only `DEEPSEEK_API_KEY` set (no `ANTHROPIC_API_KEY`)
- [ ] 5.3 Verify `wasm_agent_prompt` works with only `DEEPSEEK_API_KEY` set
- [x] 5.4 Verify nested `node_modules` copies are patched identically to main copy
