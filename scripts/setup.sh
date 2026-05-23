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
# Also adds local_agent_* MCP tools (L3 local agent loop) and fixes
# the Layer 2 WASM Agent ANTHROPIC_API_KEY pre-check.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tiancaihao/ruflo/main/scripts/setup.sh | bash
#
# After setup, set ONE of these env vars in .claude/settings.json:
#   DEEPSEEK_API_KEY  (DeepSeek — highest priority)
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_RAW="https://raw.githubusercontent.com/tiancaihao/ruflo/main"

info "Starting multi-provider setup..."

# Step 1: Ensure npx can fetch the latest ruflo
info "Downloading ruflo@latest via npx (this primes the cache)..."
npx -y ruflo@latest --version > /dev/null 2>&1 || {
    warn "ruflo --version exited non-zero (may be normal for some versions). Continuing..."
}

# Step 2: Locate the npx cache directory containing agent-execute-core.js
# Scan all caches and pick the most recently modified target file
TARGET_FILE=$(find ~/.npm/_npx -path "*/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js" -type f 2>/dev/null | while read f; do echo "$(stat -f '%m' "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0) $f"; done | sort -rn | head -1 | awk '{print $2}')

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    err "Could not find agent-execute-core.js in any npx cache."
    err "Make sure ruflo has been cached by npx. Try running:"
    err "  npx -y ruflo@latest --version"
    exit 1
fi

info "Found target: $TARGET_FILE"

# Step 3: Check if L1 patch already applied
L1_PATCHED=false
if grep -q "OPENAI_COMPAT_PROVIDERS" "$TARGET_FILE" 2>/dev/null; then
    ok "Multi-provider routing (L1) is already installed."
    L1_PATCHED=true
fi

# Step 4-6: Apply L1 multi-provider patch (skip if already done)
if [ "$L1_PATCHED" = false ]; then
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

# Step 6: Verify the L1 multi-provider patch
if grep -q "OPENAI_COMPAT_PROVIDERS" "$TARGET_FILE"; then
    ok "Multi-provider routing (L1) installed successfully!"
else
    err "Patch verification failed. Restoring backup..."
    cp "$BACKUP" "$TARGET_FILE"
    err "Original file restored. No changes were made."
    exit 1
fi
fi  # End of L1 patch block

# =============================================================================
# Step 7: Layer 2 fix — Patch agent-wasm.js to allow DEEPSEEK_API_KEY
# =============================================================================
BASE_DIR=$(dirname "$TARGET_FILE")                    # .../mcp-tools/
DIST_DIR=$(dirname "$BASE_DIR")                       # .../dist/src/
WASM_FILE="$DIST_DIR/ruvector/agent-wasm.js"

if [ -f "$WASM_FILE" ]; then
    WASM_BACKUP="$WASM_FILE.bak.$(date +%s)"
    cp "$WASM_FILE" "$WASM_BACKUP"
    info "Layer 2 WASM Agent backup at $WASM_BACKUP"

    PATCH_WASM=$(mktemp /tmp/ruflo-patch-wasm.XXXXXX.js)
    cat << 'ENDOFWASM' > "$PATCH_WASM"
const fs = require("fs");
const target = process.argv[2];
let code = fs.readFileSync(target, "utf-8");

// Fix 1: ANTHROPIC_API_KEY check → also accept DEEPSEEK_API_KEY
code = code.replace(
  /if\s*\(!process\.env\.ANTHROPIC_API_KEY\)\s*\{/,
  "if (!process.env.ANTHROPIC_API_KEY && !process.env.DEEPSEEK_API_KEY) {"
);

// Fix 2: Update error message to mention DeepSeek
code = code.replace(
  /'set ANTHROPIC_API_KEY to enable real responses via Anthropic Messages API'/,
  "'set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY to enable real responses'"
);

fs.writeFileSync(target, code, "utf-8");
ENDOFWASM

    node "$PATCH_WASM" "$WASM_FILE"
    WASM_EXIT=$?
    rm -f "$PATCH_WASM"

    if [ $WASM_EXIT -eq 0 ]; then
        ok "Layer 2 WASM Agent patched — DEEPSEEK_API_KEY now accepted."
    else
        warn "Layer 2 patch failed (non-fatal). WASM agents will need ANTHROPIC_API_KEY."
        cp "$WASM_BACKUP" "$WASM_FILE"
    fi
else
    warn "agent-wasm.js not found at $WASM_FILE — skipping Layer 2 patch."
fi

# =============================================================================
# Step 8: Download & copy local-agent-loop.js into npx cache
# =============================================================================
LOOP_TMP=$(mktemp /tmp/local-agent-loop.XXXXXX.js)

# Try local first (dev mode), then GitHub raw (curl-pipe-bash mode)
if [ -f "$SCRIPT_DIR/../src/local-agent-loop.js" ]; then
    cp "$SCRIPT_DIR/../src/local-agent-loop.js" "$LOOP_TMP"
elif [ -f "$SCRIPT_DIR/local-agent-loop.js" ]; then
    cp "$SCRIPT_DIR/local-agent-loop.js" "$LOOP_TMP"
else
    info "Downloading local-agent-loop.js from GitHub..."
    curl -fsSL "$REPO_RAW/src/local-agent-loop.js" -o "$LOOP_TMP" || {
        err "Failed to download local-agent-loop.js. Check your network."
        rm -f "$LOOP_TMP"
        exit 1
    }
fi

cp "$LOOP_TMP" "$BASE_DIR/local-agent-loop.js"
ok "local-agent-loop.js installed."
rm -f "$LOOP_TMP"

# =============================================================================
# Step 9: Download & copy local-agent-tools.js into npx cache
# =============================================================================
TOOLS_TMP=$(mktemp /tmp/local-agent-tools.XXXXXX.js)

if [ -f "$SCRIPT_DIR/../src/local-agent-tools.js" ]; then
    cp "$SCRIPT_DIR/../src/local-agent-tools.js" "$TOOLS_TMP"
elif [ -f "$SCRIPT_DIR/local-agent-tools.js" ]; then
    cp "$SCRIPT_DIR/local-agent-tools.js" "$TOOLS_TMP"
else
    info "Downloading local-agent-tools.js from GitHub..."
    curl -fsSL "$REPO_RAW/src/local-agent-tools.js" -o "$TOOLS_TMP" || {
        err "Failed to download local-agent-tools.js. Check your network."
        rm -f "$TOOLS_TMP"
        exit 1
    }
fi

cp "$TOOLS_TMP" "$BASE_DIR/local-agent-tools.js"
ok "local-agent-tools.js installed."
rm -f "$TOOLS_TMP"

# =============================================================================
# Step 10: Register localAgentTools in mcp-tools/index.js
# =============================================================================
INDEX_FILE="$BASE_DIR/index.js"
if [ -f "$INDEX_FILE" ]; then
    INDEX_BACKUP="$INDEX_FILE.bak.$(date +%s)"
    cp "$INDEX_FILE" "$INDEX_BACKUP"
    info "MCP index backup at $INDEX_BACKUP"

    # Check if already registered
    if grep -q "localAgentTools" "$INDEX_FILE" 2>/dev/null; then
        ok "localAgentTools already registered in mcp-tools/index.js."
    else
        PATCH_INDEX=$(mktemp /tmp/ruflo-patch-index.XXXXXX.js)
        cat << 'ENDOFINDEX' > "$PATCH_INDEX"
const fs = require("fs");
const target = process.argv[2];
let code = fs.readFileSync(target, "utf-8");

// Add export for localAgentTools before the last export line
code = code.replace(
  /(export \{[^}]*\}\s*from\s*'\.\/autopilot-tools\.js';)/,
  "$1\n" + "export { localAgentTools } from './local-agent-tools.js';"
);

fs.writeFileSync(target, code, "utf-8");
ENDOFINDEX

        node "$PATCH_INDEX" "$INDEX_FILE"
        INDEX_EXIT=$?
        rm -f "$PATCH_INDEX"

        if [ $INDEX_EXIT -eq 0 ] && grep -q "localAgentTools" "$INDEX_FILE"; then
            ok "localAgentTools registered in mcp-tools/index.js."
        else
            warn "Failed to register localAgentTools (non-fatal). Manual registration may be needed."
            cp "$INDEX_BACKUP" "$INDEX_FILE"
        fi
    fi
else
    warn "mcp-tools/index.js not found — skipping tool registration."
fi

# =============================================================================
# Step 11: Final verification
# =============================================================================
echo ""
ok "Ruflo multi-provider setup complete!"
echo ""
info "What was installed:"
echo "  L1: agent_execute → multi-provider routing (DeepSeek, Qwen, Kimi, Zhipu, Doubao)"
echo "  L2: wasm_agent_*  → DEEPSEEK_API_KEY accepted (no longer Anthropic-only)"
echo "  L3: local_agent_* → Local agent loop via DeepSeek/Qwen function calling"
echo ""
info "Tools available:"
echo "  local_agent_create     — Create a new local agent"
echo "  local_agent_prompt     — Run a task (supports async: true)"
echo "  local_agent_status     — Check progress"
echo "  local_agent_events     — View full transcript"
echo "  local_agent_list       — List all local agents"
echo "  local_agent_terminate  — Stop and clean up"
echo ""
# =============================================================================
# Step 12: Interactive provider configuration
# =============================================================================

PROVIDER_NAMES=("DeepSeek" "Qwen (DashScope)" "Kimi (Moonshot)" "Zhipu (BigModel/GLM)" "Doubao (Ark/ByteDance)")
PROVIDER_VARS=("DEEPSEEK_API_KEY" "DASHSCOPE_API_KEY" "MOONSHOT_API_KEY" "ZHIPU_API_KEY" "ARK_API_KEY")
PROVIDER_URLS=("https://api.deepseek.com/v1/models" "https://dashscope.aliyuncs.com/api/v1/models" "https://api.moonshot.cn/v1/models" "https://open.bigmodel.cn/api/paas/v4/models" "https://ark.cn-beijing.volces.com/api/v3/models")
PROVIDER_MODELS=("deepseek-v4-flash" "qwen3.6-plus" "kimi-k2.5" "glm-4.6" "doubao-seed-1.6")

test_connectivity() {
  local url="$1" apikey="$2"
  curl -s -o /dev/null -w "%{http_code}" -X GET "$url" \
    -H "Authorization: Bearer $apikey" \
    -H "Content-Type: application/json" \
    --max-time 10 2>/dev/null
}

print_manual_guide() {
  echo ""
  info "Manual API key configuration:"
  echo "  1. Set one of these env vars in .claude/settings.json under the MCP server config:"
  for i in "${!PROVIDER_NAMES[@]}"; do
    printf "     %-20s → %s\n" "${PROVIDER_VARS[$i]}" "${PROVIDER_NAMES[$i]}"
  done
  echo "  2. Optional: MAX_CONCURRENT_LOCAL_AGENTS=5 (default: 3)"
  echo "  3. Restart Claude Code (or reload the MCP server)"
  echo "  4. Test: local_agent_create + local_agent_prompt"
}

# ---- TTY detection: skip interactive menu in non-TTY (pipe, CI) ----
if [ -t 0 ]; then
  echo ""
  info "Let's configure your LLM provider API key now."

  PS3="Enter number (1-${#PROVIDER_NAMES[@]}, or $(( ${#PROVIDER_NAMES[@]} + 1 )) to skip): "

  select PROVIDER_CHOICE in "${PROVIDER_NAMES[@]}" "Skip — I'll configure later"; do
    if [ -n "$PROVIDER_CHOICE" ]; then
      break
    fi
    echo "Invalid selection. Please enter a number from 1 to $(( ${#PROVIDER_NAMES[@]} + 1 ))."
  done

  if [ "$PROVIDER_CHOICE" = "Skip — I'll configure later" ]; then
    print_manual_guide
    echo ""
    info "One-liner for new users:"
    echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
    echo ""
    exit 0
  fi

  # Resolve selected index
  IDX=-1
  for i in "${!PROVIDER_NAMES[@]}"; do
    if [ "${PROVIDER_NAMES[$i]}" = "$PROVIDER_CHOICE" ]; then
      IDX=$i
      break
    fi
  done

  ENV_VAR="${PROVIDER_VARS[$IDX]}"
  TEST_URL="${PROVIDER_URLS[$IDX]}"
  DEFAULT_MODEL="${PROVIDER_MODELS[$IDX]}"

  ATTEMPTS=0
  MAX_ATTEMPTS=3

  while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    echo ""
    info "Provider: $PROVIDER_CHOICE"
    info "Required env var: $ENV_VAR"
    echo ""
    read -s -p "Enter your API key (input hidden, press Enter when done): " APIKEY
    echo ""

    if [ -z "$APIKEY" ]; then
      warn "API key cannot be empty."
      ATTEMPTS=$((ATTEMPTS + 1))
      REMAINING=$((MAX_ATTEMPTS - ATTEMPTS))
      if [ $REMAINING -gt 0 ]; then
        info "Remaining attempts: $REMAINING"
      fi
      continue
    fi

    echo ""
    info "Testing connectivity to $PROVIDER_CHOICE..."
    HTTP_CODE=$(test_connectivity "$TEST_URL" "$APIKEY")

    if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
      ok "Connection successful! (HTTP $HTTP_CODE) — API key is valid."
      echo ""
      ok "=== Setup complete! ==="
      echo ""
      info "To use this key in your current terminal, run:"
      echo ""
      echo "    export $ENV_VAR=\"\$YOUR_API_KEY\""
      echo ""
      info "Or add to .claude/settings.json MCP server env config:"
      echo ""
      echo '    "env": {'
      echo "      \"$ENV_VAR\": \"<your-api-key>\""
      echo '    }'
      echo ""
      info "Default model for this provider: $DEFAULT_MODEL"
      info "Restart Claude Code (or reload the MCP server), then test with:"
      echo "  local_agent_create + local_agent_prompt"
      echo ""
      info "One-liner for new users:"
      echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
      echo ""
      exit 0
    elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
      warn "API key rejected (HTTP $HTTP_CODE). Check that your key is correct and not expired."
      ATTEMPTS=$((ATTEMPTS + 1))
      REMAINING=$((MAX_ATTEMPTS - ATTEMPTS))
      if [ $REMAINING -gt 0 ]; then
        info "Remaining attempts: $REMAINING"
      fi
    elif [ "$HTTP_CODE" = "000" ] || [ -z "$HTTP_CODE" ]; then
      warn "Network error: unable to reach the API endpoint. Check your internet connection."
      ATTEMPTS=$((ATTEMPTS + 1))
      REMAINING=$((MAX_ATTEMPTS - ATTEMPTS))
      if [ $REMAINING -gt 0 ]; then
        info "Remaining attempts: $REMAINING"
      fi
    else
      warn "Unexpected response (HTTP $HTTP_CODE). The API may be temporarily unavailable."
      ATTEMPTS=$((ATTEMPTS + 1))
      REMAINING=$((MAX_ATTEMPTS - ATTEMPTS))
      if [ $REMAINING -gt 0 ]; then
        info "Remaining attempts: $REMAINING"
      fi
    fi
  done

  # Max attempts exhausted
  echo ""
  warn "3 attempts exhausted — switching to manual configuration."
  print_manual_guide
  echo ""
  info "One-liner for new users:"
  echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
  echo ""

else
  # ---- Non-interactive mode: print manual guide ----
  print_manual_guide
  echo ""
  info "One-liner for new users:"
  echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
  echo ""
fi
