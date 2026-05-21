#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ruflo multi-provider setup — one-command onboarding
# =============================================================================
#
# Downloads the latest ruflo CLI via npx and patches the compiled
# agent-execute-core.js with multi-provider LLM routing so you can
# use DeepSeek, Qwen, Kimi, Zhipu, or Doubao instead of Anthropic.
#
# Usage:
#   ./scripts/setup.sh
#
# After setup, set ONE of these env vars in .claude/settings.json:
#   DEEPSEEK_API_KEY  (DeepSeek — Anthropic-compatible, highest priority)
#   DASHSCOPE_API_KEY (Qwen / DashScope)
#   MOONSHOT_API_KEY  (Kimi / Moonshot)
#   ZHIPU_API_KEY     (Zhipu / BigModel)
#   ARK_API_KEY       (Doubao / Ark)
#
# Or use RUFLO_PROVIDER=<name> to explicitly choose a provider.
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[ruflo-setup]${NC} $*"; }
ok()    { echo -e "${GREEN}[ruflo-setup]${NC} ✓ $*"; }
warn()  { echo -e "${YELLOW}[ruflo-setup]${NC} ⚠ $*"; }
err()   { echo -e "${RED}[ruflo-setup]${NC} ✗ $*"; }

info "Starting multi-provider setup..."

# Step 1: Ensure npx can fetch the latest ruflo
info "Downloading ruflo@latest via npx (this primes the cache)..."
npx -y ruflo@latest --help > /dev/null 2>&1 || {
    warn "ruflo --help exited non-zero (may be normal for some versions). Continuing..."
}

# Step 2: Locate the npx cache directory containing agent-execute-core.js
# Scan all caches and pick the most recently modified target file
TARGET_FILE=$(find ~/.npm/_npx -path "*/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js" -type f 2>/dev/null | while read f; do echo "$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0) $f"; done | sort -rn | head -1 | awk '{print $2}')

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    err "Could not find agent-execute-core.js in any npx cache."
    err "Make sure ruflo has been cached by npx. Try running:"
    err "  npx -y ruflo@latest --help"
    exit 1
fi

info "Found target: $TARGET_FILE"

# Step 3: Check if already patched
if grep -q "OPENAI_COMPAT_PROVIDERS" "$TARGET_FILE" 2>/dev/null; then
    ok "Multi-provider routing is already installed."
    echo ""
    info "Next steps:"
    echo "  1. Set one of these env vars in .claude/settings.json:"
    echo "     DEEPSEEK_API_KEY, DASHSCOPE_API_KEY, MOONSHOT_API_KEY,"
    echo "     ZHIPU_API_KEY, ARK_API_KEY"
    echo "  2. Restart Claude Code"
    echo ""
    info "Setup complete."
    exit 0
fi

# Step 4: Create backup
BACKUP="$TARGET_FILE.bak.$(date +%s)"
cp "$TARGET_FILE" "$BACKUP"
info "Backup created at $BACKUP"

# Step 5: Apply the multi-provider patch via node (temp file to avoid escaping hell)
info "Patching agent-execute-core.js with multi-provider routing..."

PATCH_SCRIPT=$(mktemp /tmp/ruflo-patch.XXXXXX.js)
cat << 'ENDOFPATCH' > "$PATCH_SCRIPT"
const fs = require("fs");
const target = process.argv[2];
let code = fs.readFileSync(target, "utf-8");

// ---- Provider config table ----
const PROVIDER_TABLE = [
"// --- ruflo multi-provider routing (setup.sh patch) ---",
"const OPENAI_COMPAT_PROVIDERS = {",
"  qwen: {",
'    name: "Qwen",',
'    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",',
'    envKey: "DASHSCOPE_API_KEY",',
'    defaultModel: "qwen3.6-flash",',
'    haikuModel: "qwen3.6-flash",',
'    sonnetModel: "qwen3.6-plus",',
'    opusModel: "qwen3.6-max-preview",',
"  },",
"  kimi: {",
'    name: "Kimi",',
'    baseURL: "https://api.moonshot.cn/v1",',
'    envKey: "MOONSHOT_API_KEY",',
'    defaultModel: "kimi-k2-turbo-preview",',
'    haikuModel: "kimi-k2-turbo-preview",',
'    sonnetModel: "kimi-k2.6",',
'    opusModel: "kimi-k2.6",',
"  },",
"  zhipu: {",
'    name: "Zhipu",',
'    baseURL: "https://open.bigmodel.cn/api/paas/v4",',
'    envKey: "ZHIPU_API_KEY",',
'    defaultModel: "GLM-4.7-Flash",',
'    haikuModel: "GLM-4.7-Flash",',
'    sonnetModel: "GLM-5",',
'    opusModel: "GLM-5.1",',
"  },",
"  doubao: {",
'    name: "Doubao",',
'    baseURL: "https://ark.cn-beijing.volces.com/api/v3",',
'    envKey: "ARK_API_KEY",',
'    defaultModel: "doubao-lite-32k",',
'    haikuModel: "doubao-lite-32k",',
'    sonnetModel: "doubao-pro-32k",',
'    opusModel: "doubao-pro-32k",',
"  },",
"};",
"",
"function findFirstOpenAICompatKey() {",
"  for (const [provider, cfg] of Object.entries(OPENAI_COMPAT_PROVIDERS)) {",
"    const key = process.env[cfg.envKey];",
'    if (key) { return { provider, ...cfg, apiKey: key }; }',
"  }",
"  return null;",
"}",
"",
"function resolveOpenAICompatModel(tier, provider) {",
"  const cfg = OPENAI_COMPAT_PROVIDERS[provider];",
"  if (!cfg) return cfg ? cfg.defaultModel : undefined;",
'  if (tier === "haiku") return cfg.haikuModel || cfg.defaultModel;',
'  if (tier === "opus") return cfg.opusModel || cfg.sonnetModel || cfg.defaultModel;',
"  return cfg.sonnetModel || cfg.defaultModel;",
"}",
].join("\n");

// Prepend provider table to code
code = PROVIDER_TABLE + "\n" + code;

// ---- Add callOpenAICompat function ----
const callOpenAICompatFn = [
"",
"async function callOpenAICompat(input, compatProvider) {",
'  const url = compatProvider.baseURL + "/chat/completions";',
"  const model = compatProvider.chosenModel || compatProvider.defaultModel;",
"  const startedAt = Date.now();",
"  try {",
"    const controller = new AbortController();",
"    const timer = setTimeout(function() { controller.abort(); }, input.timeoutMs || 60000);",
"    const messages = [];",
'    if (input.systemPrompt) messages.push({ role: "system", content: input.systemPrompt });',
'    messages.push({ role: "user", content: input.prompt });',
"    const res = await fetch(url, {",
'      method: "POST",',
'      headers: { Authorization: "Bearer " + compatProvider.apiKey, "content-type": "application/json" },',
"      body: JSON.stringify({ model: model, max_tokens: input.maxTokens || 1024, temperature: typeof input.temperature === \"number\" ? input.temperature : 0.7, messages: messages }),",
"      signal: controller.signal,",
"    });",
"    clearTimeout(timer);",
"    if (!res.ok) {",
'      const errText = await res.text().catch(function() { return "<unreadable error body>"; });',
'      return { success: false, model: model, error: compatProvider.name + " API error " + res.status + ": " + errText.slice(0, 400) };',
"    }",
"    const data = await res.json();",
'    const textOut = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";',
"    const usage = data.usage || {};",
"    return {",
"      success: true,",
"      model: data.model || model,",
'      messageId: data.id || (compatProvider.provider + "-" + Date.now()),',
'      stopReason: (data.choices && data.choices[0] && data.choices[0].finish_reason) || "stop",',
"      output: textOut,",
"      usage: { inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, totalTokens: (usage.total_tokens || 0) },",
"      durationMs: Date.now() - startedAt,",
"    };",
"  } catch (err) {",
"    return { success: false, model: model, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt };",
"  }",
"}",
].join("\n");

// Insert callOpenAICompat before callAnthropicMessages (include 'export' to preserve the export on callAnthropicMessages)
code = code.replace(/(export async function callAnthropicMessages)/, callOpenAICompatFn + "\n$1");

// ---- Add callDeepSeekMessages function ----
const callDeepSeekFn = [
"",
"async function callDeepSeekMessages(input) {",
'  const model = input.model || "deepseek-v4-flash";',
"  const startedAt = Date.now();",
"  try {",
"    const controller = new AbortController();",
"    const timer = setTimeout(function() { controller.abort(); }, input.timeoutMs || 60000);",
'    const body = { model: model, max_tokens: input.maxTokens || 1024, temperature: typeof input.temperature === "number" ? input.temperature : 0.7, messages: [{ role: "user", content: input.prompt }] };',
"    if (input.systemPrompt) body.system = input.systemPrompt;",
'    const res = await fetch("https://api.deepseek.com/anthropic/v1/messages", {',
'      method: "POST",',
'      headers: { "x-api-key": input.apiKey, "content-type": "application/json" },',
"      body: JSON.stringify(body),",
"      signal: controller.signal,",
"    });",
"    clearTimeout(timer);",
"    if (!res.ok) {",
'      const errText = await res.text().catch(function() { return "<unreadable error body>"; });',
'      return { success: false, model: model, error: "DeepSeek API error " + res.status + ": " + errText.slice(0, 400) };',
"    }",
"    const data = await res.json();",
"    const __textBlocks = data.content.filter(function(c) { return c.type === \"text\" && typeof c.text === \"string\"; }).map(function(c) { return c.text; });",
"    const textOut = __textBlocks.length > 0 ? __textBlocks.join(\"\") : data.content.filter(function(c) { return c.type === \"thinking\" && typeof c.thinking === \"string\"; }).map(function(c) { return c.thinking; }).join(\"\");",
"    return {",
"      success: true,",
"      model: data.model,",
"      messageId: data.id,",
"      stopReason: data.stop_reason,",
"      output: textOut,",
"      usage: { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens, totalTokens: data.usage.input_tokens + data.usage.output_tokens },",
"      durationMs: Date.now() - startedAt,",
"    };",
"  } catch (err) {",
"    return { success: false, model: model, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt };",
"  }",
"}",
].join("\n");

code = code.replace(/(export async function callAnthropicMessages)/, callDeepSeekFn + "\n$1");

// ---- Patch callAnthropicMessages ----
code = code.replace(
  /(async function callAnthropicMessages\([^)]*\)\s*\{)/,
  "$1\n  // Multi-provider: check DeepSeek first\n  const __deepseekKey = process.env.DEEPSEEK_API_KEY;\n  const __explicitProvider = (process.env.RUFLO_PROVIDER || \"\").toLowerCase();\n  const __useDeepSeek = __explicitProvider === \"deepseek\" || (!__explicitProvider && !!__deepseekKey);\n  if (__useDeepSeek && __deepseekKey) {\n    var __dsTier = input.model === \"haiku\" ? \"haiku\" : input.model === \"opus\" ? \"opus\" : \"sonnet\";\n    var __dsModel = __dsTier === \"opus\" ? \"deepseek-v4-pro\" : \"deepseek-v4-flash\";\n    return callDeepSeekMessages(Object.assign({}, input, { apiKey: __deepseekKey, model: __dsModel }));\n  }\n\n  // Multi-provider: check OpenAI-compat providers (Qwen, Kimi, Zhipu, Doubao)\n  const __compat = findFirstOpenAICompatKey();\n  if (__compat && (__explicitProvider === __compat.provider || !__explicitProvider || __explicitProvider === \"ollama\")) {\n    var __tier = input.model === \"haiku\" ? \"haiku\" : input.model === \"opus\" ? \"opus\" : \"sonnet\";\n    __compat.chosenModel = __compat[__tier + \"Model\"] || __compat.defaultModel;\n    return callOpenAICompat(input, __compat);\n  }\n"
);

// ---- Patch executeAgentTask ----
code = code.replace(
  /(async function executeAgentTask\([^)]*\)\s*\{)/,
  "$1\n  // Multi-provider: check for DeepSeek or OpenAI-compat keys\n  const __dsKey = process.env.DEEPSEEK_API_KEY;\n  const __explicitP = (process.env.RUFLO_PROVIDER || \"\").toLowerCase();\n  const __useDS = __explicitP === \"deepseek\" || (!__explicitP && !!__dsKey);\n  const __compatP = !__useDS ? findFirstOpenAICompatKey() : null;\n  const __useCompat = __compatP && (__explicitP === __compatP.provider || !__explicitP);\n"
);

// Update the API key check to allow multi-provider (split into simple replacements to avoid nested-brace regex issues)
code = code.replace(
  /const apiKey = process\.env\.ANTHROPIC_API_KEY;/,
  "const apiKey = process.env.ANTHROPIC_API_KEY; const __hasOther = __useDS || __useCompat || process.env.OLLAMA_API_KEY;"
);
code = code.replace(
  /if\s*\(!apiKey\)/,
  "if (!apiKey && !__hasOther)"
);
code = code.replace(
  /'ANTHROPIC_API_KEY not set in environment'/,
  "'No LLM provider configured. Set DEEPSEEK_API_KEY, DASHSCOPE_API_KEY (Qwen), MOONSHOT_API_KEY (Kimi), ZHIPU_API_KEY (GLM), ARK_API_KEY (Doubao), OLLAMA_API_KEY, or ANTHROPIC_API_KEY.'"
);

// Add routing before the fetch call in executeAgentTask (use saveAgentStore as anchor unique to executeAgentTask)
code = code.replace(
  /(saveAgentStore\(store\);)(\s*)(const startedAt = Date\.now\(\);)(\s*)(try\s*\{)/,
  "$1\n\n// Multi-provider routing\nif (__useDS && __dsKey) {\n  const __tier = agent.model || \"sonnet\";\n  const __dsModel = __tier === \"opus\" ? \"deepseek-v4-pro\" : \"deepseek-v4-flash\";\n  const __dsResult = await callDeepSeekMessages({ prompt: input.prompt, systemPrompt: systemPrompt, model: __dsModel, maxTokens: input.maxTokens, temperature: input.temperature, timeoutMs: input.timeoutMs, apiKey: __dsKey });\n  if (__dsResult.success) {\n    agent.status = \"idle\"; agent.lastResult = __dsResult; saveAgentStore(store);\n    return { success: true, agentId: input.agentId, messageId: __dsResult.messageId, model: __dsResult.model, stopReason: __dsResult.stopReason, output: __dsResult.output, usage: __dsResult.usage, durationMs: __dsResult.durationMs };\n  }\n  agent.status = \"idle\"; saveAgentStore(store);\n  return { success: false, agentId: input.agentId, model: __dsModel, error: __dsResult.error };\n}\n\nif (__useCompat && __compatP) {\n  const __tier = agent.model || \"sonnet\";\n  const __model = resolveOpenAICompatModel(__tier, __compatP.provider);\n  __compatP.chosenModel = __model;\n  const __result = await callOpenAICompat({ prompt: input.prompt, systemPrompt: systemPrompt, model: __model, maxTokens: input.maxTokens, temperature: input.temperature, timeoutMs: input.timeoutMs }, __compatP);\n  if (__result.success) {\n    agent.status = \"idle\"; agent.lastResult = __result; saveAgentStore(store);\n    return { success: true, agentId: input.agentId, messageId: __result.messageId, model: __result.model, stopReason: __result.stopReason, output: __result.output, usage: __result.usage, durationMs: __result.durationMs };\n  }\n  agent.status = \"idle\"; saveAgentStore(store);\n  return { success: false, agentId: input.agentId, model: __model, error: __result.error };\n}\n\n$3$4$5"
);

fs.writeFileSync(target, code, "utf-8");
ENDOFPATCH

node "$PATCH_SCRIPT" "$TARGET_FILE"
PATCH_EXIT=$?
rm -f "$PATCH_SCRIPT"

if [ $PATCH_EXIT -ne 0 ]; then
    err "Patch script failed with exit code $PATCH_EXIT. Restoring backup..."
    cp "$BACKUP" "$TARGET_FILE"
    err "Original file restored. No changes were made."
    exit 1
fi

# Step 6: Verify the patch
if grep -q "OPENAI_COMPAT_PROVIDERS" "$TARGET_FILE"; then
    ok "Multi-provider routing installed successfully!"
    echo ""
    info "Next steps:"
    echo "  1. Set one of these env vars in .claude/settings.json under the MCP server config:"
    echo "     DEEPSEEK_API_KEY  → DeepSeek (Anthropic-compatible, highest priority)"
    echo "     DASHSCOPE_API_KEY → Qwen / DashScope (Alibaba)"
    echo "     MOONSHOT_API_KEY  → Kimi / Moonshot"
    echo "     ZHIPU_API_KEY     → Zhipu / BigModel"
    echo "     ARK_API_KEY       → Doubao / Ark (ByteDance)"
    echo "  2. Or add them to the \"env\" block of your MCP server in .claude/settings.json"
    echo "  3. Restart Claude Code (or reload the MCP server)"
    echo "  4. Test: spawn an agent — it should auto-route to your provider"
    echo ""
    info "Setup complete. Set your API key and restart Claude Code."
else
    err "Patch verification failed. Restoring backup..."
    cp "$BACKUP" "$TARGET_FILE"
    err "Original file restored. No changes were made."
    exit 1
fi
