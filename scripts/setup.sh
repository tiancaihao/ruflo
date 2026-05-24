#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# ruflo multi-provider setup — one-command onboarding
# =============================================================================
#
# Installs ruflo globally and patches agent-execute-core.js with multi-provider
# LLM routing so you can use DeepSeek, Qwen, Kimi, Zhipu, or Doubao instead of
# Anthropic.
#
# .mcp.json uses "ruflo mcp start" (portable, no machine-specific paths).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tiancaihao/ruflo/main/scripts/setup.sh | bash
#
# After setup, the API key is stored in .mcp.json under mcpServers.ruflo.env:
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

# Create temp file with fallback to PID-based name if mktemp fails (e.g. stale XXXX files)
safe_mktemp() {
  mktemp "$1" 2>/dev/null || echo "${1//XXXXXX/$$}"
}

info "Starting multi-provider setup..."

# =============================================================================
# Step 1: Ensure ruflo is available globally (required for "ruflo mcp start")
# =============================================================================
if ! command -v ruflo &>/dev/null; then
  info "ruflo not found in PATH. Installing globally via npm..."
  npm install -g ruflo@latest || {
    err "npm install -g ruflo@latest failed. Check your npm permissions or try:"
    err "  sudo npm install -g ruflo@latest"
    exit 1
  }
  ok "ruflo installed globally."
else
  ok "ruflo already installed: $(which ruflo)"
fi

# =============================================================================
# Step 2: Initialize project (always, idempotent — --force re-inits safely)
# Creates .mcp.json with "npx ruflo@latest mcp start" (we'll replace later)
# =============================================================================
info "Initializing ruflo project..."
if ruflo init --force 2>/dev/null; then
  ok "ruflo project initialized."
else
  warn "ruflo init had warnings (non-fatal). Continuing..."
fi

# =============================================================================
# Step 3: Find target file for patching (prefer global install)
# =============================================================================

# Search for agent-execute-core.js, prefer global install over npx cache.
# Global install paths are stable; npx cache has hash-based paths that change on update.
find_target_file() {
  for search_dir in \
    "$(npm root -g 2>/dev/null)" \
    ~/.nvm/versions/node/*/lib/node_modules \
    /usr/local/lib/node_modules \
    ~/.npm/_npx; \
  do
    [ -d "$search_dir" ] 2>/dev/null || continue
    result=$(find "$search_dir" -path "*/@claude-flow/cli/dist/src/mcp-tools/agent-execute-core.js" -type f 2>/dev/null | head -1)
    if [ -n "$result" ]; then
      echo "$result"
      return 0
    fi
  done
  return 1
}

TARGET_FILE=$(find_target_file)

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
    err "Could not find agent-execute-core.js after global install."
    err "Try running: npm install -g ruflo@latest"
    exit 1
fi

info "Found target: $TARGET_FILE"

# Step 3: Create backup
BACKUP="$TARGET_FILE.bak.$(date +%s)"
cp "$TARGET_FILE" "$BACKUP"
info "Backup created at $BACKUP"

# Step 4: Apply L1 multi-provider patch (idempotent — safe to re-run)
info "Patching agent-execute-core.js with multi-provider routing..."

PATCH_SCRIPT=$(safe_mktemp /tmp/ruflo-patch.XXXXXX.cjs)
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

// Only prepend provider table if not already patched (idempotent)
if (!code.includes("// --- ruflo multi-provider routing")) {
  code = PROVIDER_TABLE + "\n" + code;
} else {
  // Replace old provider table: remove from marker to end of resolveOpenAICompatModel
  const marker = "// --- ruflo multi-provider routing (setup.sh patch) ---";
  const idx = code.indexOf(marker);
  if (idx !== -1) {
    // find the closing } of resolveOpenAICompatModel
    const funcStart = code.indexOf("function resolveOpenAICompatModel", idx);
    if (funcStart !== -1) {
      let braceCount = 0;
      let inFunc = false;
      let endIdx = funcStart;
      for (let i = funcStart; i < code.length; i++) {
        if (code[i] === '{') { braceCount++; inFunc = true; }
        if (code[i] === '}') {
          braceCount--;
          if (inFunc && braceCount === 0) { endIdx = i + 1; break; }
        }
      }
      code = code.slice(0, idx) + code.slice(endIdx);
    }
  }
  code = PROVIDER_TABLE + "\n" + code;
}

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

// Only insert callOpenAICompat if not already present (idempotent)
if (!code.includes("async function callOpenAICompat")) {
  code = code.replace(/(export async function callAnthropicMessages)/, callOpenAICompatFn + "\n$1");
}

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

// Only insert callDeepSeekMessages if not already present (idempotent)
if (!code.includes("async function callDeepSeekMessages")) {
  code = code.replace(/(export async function callAnthropicMessages)/, callDeepSeekFn + "\n$1");
}

// Only patch callAnthropicMessages if not already done (idempotent)
if (!code.includes("// Multi-provider: check DeepSeek first")) {
  code = code.replace(
    /(async function callAnthropicMessages\([^)]*\)\s*\{)/,
    "$1\n  // Multi-provider: check DeepSeek first\n  const __deepseekKey = process.env.DEEPSEEK_API_KEY;\n  const __explicitProvider = (process.env.RUFLO_PROVIDER || \"\").toLowerCase();\n  const __useDeepSeek = __explicitProvider === \"deepseek\" || (!__explicitProvider && !!__deepseekKey);\n  if (__useDeepSeek && __deepseekKey) {\n    var __dsTier = input.model === \"haiku\" ? \"haiku\" : input.model === \"opus\" ? \"opus\" : \"sonnet\";\n    var __dsModel = __dsTier === \"opus\" ? \"deepseek-v4-pro\" : \"deepseek-v4-flash\";\n    return callDeepSeekMessages(Object.assign({}, input, { apiKey: __deepseekKey, model: __dsModel }));\n  }\n\n  // Multi-provider: check OpenAI-compat providers (Qwen, Kimi, Zhipu, Doubao)\n  const __compat = findFirstOpenAICompatKey();\n  if (__compat && (__explicitProvider === __compat.provider || !__explicitProvider || __explicitProvider === \"ollama\")) {\n    var __tier = input.model === \"haiku\" ? \"haiku\" : input.model === \"opus\" ? \"opus\" : \"sonnet\";\n    __compat.chosenModel = __compat[__tier + \"Model\"] || __compat.defaultModel;\n    return callOpenAICompat(input, __compat);\n  }\n"
  );
}

// Only patch executeAgentTask if not already done (idempotent)
if (!code.includes("// Multi-provider: check for DeepSeek or OpenAI-compat keys")) {
  code = code.replace(
    /(async function executeAgentTask\([^)]*\)\s*\{)/,
    "$1\n  // Multi-provider: check for DeepSeek or OpenAI-compat keys\n  const __dsKey = process.env.DEEPSEEK_API_KEY;\n  const __explicitP = (process.env.RUFLO_PROVIDER || \"\").toLowerCase();\n  const __useDS = __explicitP === \"deepseek\" || (!__explicitP && !!__dsKey);\n  const __compatP = !__useDS ? findFirstOpenAICompatKey() : null;\n  const __useCompat = __compatP && (__explicitP === __compatP.provider || !__explicitP);\n"
  );
}

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

// Only add routing block if not already present (idempotent)
if (!code.includes("// Multi-provider routing")) {
  code = code.replace(
    /(saveAgentStore\(store\);)(\s*)(const startedAt = Date\.now\(\);)(\s*)(try\s*\{)/,
    "$1\n\n// Multi-provider routing\nif (__useDS && __dsKey) {\n  const __tier = agent.model || \"sonnet\";\n  const __dsModel = __tier === \"opus\" ? \"deepseek-v4-pro\" : \"deepseek-v4-flash\";\n  const __dsResult = await callDeepSeekMessages({ prompt: input.prompt, systemPrompt: systemPrompt, model: __dsModel, maxTokens: input.maxTokens, temperature: input.temperature, timeoutMs: input.timeoutMs, apiKey: __dsKey });\n  if (__dsResult.success) {\n    agent.status = \"idle\"; agent.lastResult = __dsResult; saveAgentStore(store);\n    return { success: true, agentId: input.agentId, messageId: __dsResult.messageId, model: __dsResult.model, stopReason: __dsResult.stopReason, output: __dsResult.output, usage: __dsResult.usage, durationMs: __dsResult.durationMs };\n  }\n  agent.status = \"idle\"; saveAgentStore(store);\n  return { success: false, agentId: input.agentId, model: __dsModel, error: __dsResult.error };\n}\n\nif (__useCompat && __compatP) {\n  const __tier = agent.model || \"sonnet\";\n  const __model = resolveOpenAICompatModel(__tier, __compatP.provider);\n  __compatP.chosenModel = __model;\n  const __result = await callOpenAICompat({ prompt: input.prompt, systemPrompt: systemPrompt, model: __model, maxTokens: input.maxTokens, temperature: input.temperature, timeoutMs: input.timeoutMs }, __compatP);\n  if (__result.success) {\n    agent.status = \"idle\"; agent.lastResult = __result; saveAgentStore(store);\n    return { success: true, agentId: input.agentId, messageId: __result.messageId, model: __result.model, stopReason: __result.stopReason, output: __result.output, usage: __result.usage, durationMs: __result.durationMs };\n  }\n  agent.status = \"idle\"; saveAgentStore(store);\n  return { success: false, agentId: input.agentId, model: __model, error: __result.error };\n}\n\n$3$4$5"
  );
}

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

# =============================================================================
# Step 6: Layer 2 fix — Patch agent-wasm.js to allow DEEPSEEK_API_KEY
# =============================================================================
BASE_DIR=$(dirname "$TARGET_FILE")                    # .../mcp-tools/
DIST_DIR=$(dirname "$BASE_DIR")                       # .../dist/src/
WASM_FILE="$DIST_DIR/ruvector/agent-wasm.js"

if [ -f "$WASM_FILE" ]; then
    WASM_BACKUP="$WASM_FILE.bak.$(date +%s)"
    cp "$WASM_FILE" "$WASM_BACKUP"
    info "Layer 2 WASM Agent backup at $WASM_BACKUP"

    PATCH_WASM=$(safe_mktemp /tmp/ruflo-patch-wasm.XXXXXX.cjs)
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
LOOP_TMP=$(safe_mktemp /tmp/local-agent-loop.XXXXXX.cjs)

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
TOOLS_TMP=$(safe_mktemp /tmp/local-agent-tools.XXXXXX.cjs)

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
        PATCH_INDEX=$(safe_mktemp /tmp/ruflo-patch-index.XXXXXX.cjs)
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
info "MCP config: .mcp.json → ruflo mcp start (portable)"
echo ""
warn "IMPORTANT: Do NOT run 'claude mcp add ruflo' after this setup —"
echo "  it will overwrite the patched config. If you accidentally do,"
echo "  just re-run this script: curl -fsSL ... | bash"
echo ""
info "Tools available:"
echo "  local_agent_create     — Create a new local agent"
echo "  local_agent_prompt     — Run a task (supports async: true)"
echo "  local_agent_status     — Check progress"
echo "  local_agent_events     — View full transcript"
echo "  local_agent_list       — List all local agents"
echo "  local_agent_terminate  — Stop and clean up"
echo ""
info "Note: If you update ruflo globally (npm update -g ruflo), patches may be"
echo "  overwritten. Just re-run this script: bash scripts/setup.sh"
echo ""

# =============================================================================
# Step 11.5: Lock MCP server to global ruflo (always — even without API key)
# Uses "ruflo mcp start" (portable, no machine-specific paths) in .mcp.json
# Re-run setup.sh after "npm update -g ruflo" to re-apply patches.
# =============================================================================

lock_mcp_config() {
  local mcp_file="$1"
  local server_name="$2"      # server name to use (e.g. "ruflo" or "claude-flow")
  local env_vars_to_add="$3"  # optional: "KEY=val" pairs to merge into env

  if ! command -v ruflo &>/dev/null; then
    warn "ruflo not found in PATH — cannot write portable MCP config."
    warn "Install it globally: npm install -g ruflo@latest"
    return 1
  fi

  LOCK_SCRIPT=$(safe_mktemp /tmp/ruflo-mcp-lock.XXXXXX.cjs)
  cat << 'ENDLOCK' > "$LOCK_SCRIPT"
const fs = require("fs");
const target = process.argv[2];
const forceServerName = process.argv[3] || "";
const extraEnvRaw = process.argv[4] || "";  // KEY1=val1\nKEY2=val2

let data = { mcpServers: {} };
try {
  if (fs.existsSync(target)) {
    data = JSON.parse(fs.readFileSync(target, "utf-8"));
  }
} catch (e) {
  console.error("Failed to parse " + target + ": " + e.message);
  process.exit(1);
}

if (!data.mcpServers) data.mcpServers = {};

// Use forced server name if provided, otherwise auto-detect
let serverName = forceServerName || null;
let existingCfg = data.mcpServers[serverName] || null;

if (!serverName) {
  // Auto-detect: find existing ruflo or claude-flow key
  for (const [name, cfg] of Object.entries(data.mcpServers)) {
    const cmd = (cfg.command || "") + " " + (cfg.args || []).join(" ");
    if (cmd.includes("ruflo") || cmd.includes("claude-flow") ||
        name.includes("claude-flow") || name.includes("ruflo")) {
      serverName = name;
      existingCfg = cfg;
      break;
    }
  }
}

if (!serverName) {
  serverName = "ruflo";
}

// Merge existing env with new env vars
let mergedEnv = {};
if (existingCfg && existingCfg.env && typeof existingCfg.env === "object") {
  Object.assign(mergedEnv, existingCfg.env);
}
if (extraEnvRaw) {
  for (const line of extraEnvRaw.split("\n")) {
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      mergedEnv[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
    }
  }
}

// Portable config — uses global "ruflo" command, no machine-specific paths
const newCfg = {
  command: "ruflo",
  args: ["mcp", "start"],
};

// Only set env if we have vars (avoid empty env: {})
if (Object.keys(mergedEnv).length > 0) {
  newCfg.env = mergedEnv;
}

// Preserve autoStart if it existed
if (existingCfg && typeof existingCfg.autoStart === "boolean") {
  newCfg.autoStart = existingCfg.autoStart;
}

data.mcpServers[serverName] = newCfg;

// Clean up the OTHER possible key to prevent duplicates in this file
// (e.g. if we're writing "ruflo", remove stale "claude-flow" and vice versa)
const otherKeys = serverName === "ruflo" ? ["claude-flow"] : ["ruflo"];
for (const stale of otherKeys) {
  if (data.mcpServers[stale]) {
    console.error("Removed stale key from " + target + ": " + stale);
    delete data.mcpServers[stale];
  }
}

// Atomic write
const tmpPath = target + ".tmp." + Date.now();
fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
fs.renameSync(tmpPath, target);

console.log("MCP_CONFIG_OK server=" + serverName + " file=" + target + " cmd=ruflo");
ENDLOCK

  node "$LOCK_SCRIPT" "$mcp_file" "$server_name" "$env_vars_to_add"
  local rc=$?
  rm -f "$LOCK_SCRIPT"
  return $rc
}

# Always target project .mcp.json (priority 2 > ~/.claude.json priority 4)
# If ~/.claude.json has a ruflo/claude-flow entry, use the SAME server name
# so project-level overrides user-level — no duplicate MCP server.
MCP_FILE=".mcp.json"
MCP_SERVER_NAME="ruflo"

# Detect if ~/.claude.json has a ruflo/claude-flow entry
if [ -f "$HOME/.claude.json" ]; then
  EXISTING_USER_KEY=$(node -e "
    const fs = require('fs');
    try {
      const d = JSON.parse(fs.readFileSync(process.env.HOME + '/.claude.json', 'utf-8'));
      const servers = d.mcpServers || {};
      for (const k of Object.keys(servers)) {
        if (k.includes('claude-flow') || k.includes('ruflo')) { console.log(k); process.exit(0); }
      }
    } catch(e) {}
  " 2>/dev/null)

  if [ -n "$EXISTING_USER_KEY" ]; then
    MCP_SERVER_NAME="$EXISTING_USER_KEY"
    warn "Detected user-level MCP entry in ~/.claude.json: \"$EXISTING_USER_KEY\""
    info "Project .mcp.json will use the same name → project config overrides user config."
    info "~/.claude.json entry is NOT deleted — just overridden by project .mcp.json."
  fi
fi

# Check project .mcp.json for existing ruflo key — only use if no user-level key
# (user-level key name takes priority to ensure override works)
if [ -z "$EXISTING_USER_KEY" ] && [ -f ".mcp.json" ]; then
  EXISTING_PROJ_KEY=$(node -e "
    const fs = require('fs');
    try {
      const d = JSON.parse(fs.readFileSync('.mcp.json', 'utf-8'));
      const servers = d.mcpServers || {};
      for (const k of Object.keys(servers)) {
        if (k.includes('claude-flow') || k.includes('ruflo')) { console.log(k); process.exit(0); }
      }
    } catch(e) {}
  " 2>/dev/null)

  if [ -n "$EXISTING_PROJ_KEY" ]; then
    MCP_SERVER_NAME="$EXISTING_PROJ_KEY"
  fi
fi

# Always lock MCP command to portable "ruflo mcp start" (without API key for now)
lock_mcp_config "$MCP_FILE" "$MCP_SERVER_NAME" ""
if [ $? -eq 0 ]; then
  ok "MCP server locked: $MCP_SERVER_NAME → ruflo mcp start (portable)"
  info "Config written to: $MCP_FILE"
  if [ -n "$EXISTING_USER_KEY" ]; then
    warn "~/.claude.json has \"$EXISTING_USER_KEY\" — overridden by project .mcp.json (same key)."
    warn "Do NOT run 'claude mcp add ruflo' — it will overwrite .mcp.json."
    warn "If that happens, re-run: bash scripts/setup.sh"
  fi
else
  warn "Could not lock MCP config. You may need to re-run setup."
fi
# =============================================================================
# Step 12: Interactive provider configuration
# =============================================================================

PROVIDER_NAMES=("DeepSeek" "Qwen (DashScope)" "Kimi (Moonshot)" "Zhipu (BigModel/GLM)" "Doubao (Ark/ByteDance)")
PROVIDER_VARS=("DEEPSEEK_API_KEY" "DASHSCOPE_API_KEY" "MOONSHOT_API_KEY" "ZHIPU_API_KEY" "ARK_API_KEY")
PROVIDER_URLS=("https://api.deepseek.com/v1/models" "https://dashscope.aliyuncs.com/compatible-mode/v1/models" "https://api.moonshot.cn/v1/models" "https://open.bigmodel.cn/api/paas/v4/models" "https://ark.cn-beijing.volces.com/api/v3/models")
PROVIDER_MODELS=("deepseek-v4-flash" "qwen3.6-plus" "kimi-k2.5" "glm-4.6" "doubao-seed-1.6")

# Node.js-powered interactive select (arrow-key navigation, Enter to confirm)
# Usage: interactive_select "option1" "option2" ...
# Returns: selected index (0-based) on stdout, 255 on cancel
interactive_select() {
  local opts=("$@")
  local script result_file
  script=$(safe_mktemp /tmp/ruflo-select.XXXXXX.cjs)
  result_file=$(safe_mktemp /tmp/ruflo-select-result.XXXXXX)

  cat << 'SELECTJS' > "$script"
const fs = require('fs');

const resultFile = process.argv[2];
const opts = process.argv.slice(3);
const out = process.stderr;

let idx = 0;
const len = opts.length;

function render() {
  for (let i = 0; i < len; i++) {
    out.write('\x1b[2K');
    if (i === idx) {
      out.write('\x1b[36m❯ ' + opts[i] + '\x1b[0m\n');
    } else {
      out.write('  ' + opts[i] + '\n');
    }
  }
  if (len > 0) out.write('\x1b[' + len + 'A');
}

function cleanup() {
  out.write('\x1b[' + len + 'B');
  out.write('\x1b[?25h');
  process.stdin.setRawMode(false);
  process.stdin.pause();
}

try {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  require('readline').emitKeypressEvents(process.stdin);
  out.write('\x1b[?25l');
  render();

  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'up') {
      idx = (idx - 1 + len) % len;
      render();
    } else if (key.name === 'down') {
      idx = (idx + 1) % len;
      render();
    } else if (key.name === 'return' || key.name === 'enter') {
      cleanup();
      fs.writeFileSync(resultFile, String(idx), 'utf-8');
      process.exit(0);
    } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      cleanup();
      fs.writeFileSync(resultFile, '-1', 'utf-8');
      process.exit(0);
    }
  });
} catch (e) {
  fs.writeFileSync(resultFile, '-1', 'utf-8');
  process.exit(1);
}
SELECTJS

  node "$script" "$result_file" "${opts[@]}" </dev/tty
  local node_rc=$?

  local result
  if [ -f "$result_file" ]; then
    result=$(cat "$result_file")
  else
    result="-1"
  fi
  rm -f "$script" "$result_file"

  if [ "$result" = "-1" ] || [ $node_rc -ne 0 ]; then
    return 255
  fi
  echo "$result"
  return 0
}

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
  echo "  1. Add one of these env vars to .mcp.json under mcpServers.ruflo.env:"
  for i in "${!PROVIDER_NAMES[@]}"; do
    printf "     %-20s → %s\n" "${PROVIDER_VARS[$i]}" "${PROVIDER_NAMES[$i]}"
  done
  echo "  2. Or set the env var in your shell profile (~/.zshrc or ~/.bashrc)"
  echo "  3. Optional: MAX_CONCURRENT_LOCAL_AGENTS=5 (default: 3)"
  echo "  4. Restart Claude Code (or reload the MCP server)"
  echo "  5. Test: local_agent_create + local_agent_prompt"
}

# ---- TTY detection: skip interactive menu in non-TTY (pipe, CI) ----
# Check stdin OR /dev/tty — curl|bash makes stdin a pipe, but /dev/tty
# still works because interactive_select() redirects from it.
if [ -t 0 ] || [ -c /dev/tty ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════╗"
  echo "  ║     API Provider Configuration Wizard           ║"
  echo "  ╚══════════════════════════════════════════════════╝"
  echo ""

  # ---- Step 1: Select provider (arrow keys ↑↓, Enter to confirm) ----
  info "(1/3) Use ↑↓ to select your LLM provider, Enter to confirm:"
  echo ""

  CHOICE_IDX=$(interactive_select "${PROVIDER_NAMES[@]}" "Skip — I'll configure later")
  CHOICE_RC=$?

  # Build a clean display of what was selected
  if [ $CHOICE_RC -eq 255 ] || [ "$CHOICE_IDX" = "-1" ] || [ "$CHOICE_IDX" -ge "${#PROVIDER_NAMES[@]}" ]; then
    echo ""
    info "Skipping API key configuration."
    print_manual_guide
    echo ""
    info "One-liner for new users:"
    echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
    echo ""
    exit 0
  fi

  IDX="$CHOICE_IDX"
  PROVIDER_CHOICE="${PROVIDER_NAMES[$IDX]}"
  ENV_VAR="${PROVIDER_VARS[$IDX]}"
  TEST_URL="${PROVIDER_URLS[$IDX]}"
  DEFAULT_MODEL="${PROVIDER_MODELS[$IDX]}"

  echo ""
  echo "  Selected: $PROVIDER_CHOICE"
  echo ""

  # ---- Step 2: Enter API key ----
  info "(2/3) Enter your API key for $PROVIDER_CHOICE"

  ATTEMPTS=0
  MAX_ATTEMPTS=3

  while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    echo ""
    read -s -p "  API key (input hidden): " APIKEY
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

    # Show masked key for confirmation
    KEYLEN=${#APIKEY}
    if [ $KEYLEN -le 8 ]; then
      MASKED="****"
    else
      MASKED="${APIKEY:0:4}...${APIKEY: -4}"
    fi
    info "Key entered: $MASKED  (env var: $ENV_VAR)"

    echo ""
    info "(3/3) Testing connectivity to $PROVIDER_CHOICE..."
    HTTP_CODE=$(test_connectivity "$TEST_URL" "$APIKEY")

    if [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
      ok "Connection successful! (HTTP $HTTP_CODE) — API key is valid."
      echo ""

      # Add API key to already-locked MCP config
      lock_mcp_config "$MCP_FILE" "$MCP_SERVER_NAME" "$ENV_VAR=$APIKEY"
      if [ $? -eq 0 ]; then
        ok "API key saved to $MCP_FILE"
      else
        warn "Could not auto-save MCP config."
        info "Set it manually: export $ENV_VAR=\"<your-api-key>\""
      fi

      # ---- Doctor summary ----
      echo ""
      echo "  ╔══════════════════════════════════════════════════╗"
      echo "  ║     Configuration Complete — Summary             ║"
      echo "  ╚══════════════════════════════════════════════════╝"
      echo ""
      echo "    Provider:       $PROVIDER_CHOICE"
      echo "    API key:        $MASKED  ✓ verified"
      echo "    Default model:  $DEFAULT_MODEL"
      echo "    Env var:        $ENV_VAR"
      echo "    Config file:    $MCP_FILE"
      echo "    MCP server:     ruflo mcp start (portable)"
      echo ""
      warn "Do NOT run 'claude mcp add ruflo' — it will overwrite this config."
      echo "  If you accidentally do, re-run: bash scripts/setup.sh"
      echo ""
      info "Next: Restart Claude Code, then test with:"
      echo "  local_agent_create → local_agent_prompt"
      echo ""
      exit 0
    elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
      warn "API key rejected (HTTP $HTTP_CODE). Check that your key is correct and not expired."
      ATTEMPTS=$((ATTEMPTS + 1))
    elif [ "$HTTP_CODE" = "000" ] || [ -z "$HTTP_CODE" ]; then
      warn "Network error: unable to reach the API endpoint. Check your internet connection."
      ATTEMPTS=$((ATTEMPTS + 1))
    else
      warn "Unexpected response (HTTP $HTTP_CODE). The API may be temporarily unavailable."
      ATTEMPTS=$((ATTEMPTS + 1))
    fi

    # Offer retry/skip if attempts remain
    if [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; then
      echo ""
      info "Attempt $ATTEMPTS of $MAX_ATTEMPTS failed. What would you like to do?"
      echo ""
      RETRY_IDX=$(interactive_select "Try again" "Skip — configure later")
      if [ "$RETRY_IDX" != "0" ]; then
        echo ""
        info "Skipping API key configuration."
        print_manual_guide
        echo ""
        info "One-liner for new users:"
        echo "  curl -fsSL $REPO_RAW/scripts/setup.sh | bash"
        echo ""
        exit 0
      fi
      echo ""
      info "Let's try again. (2/3) Enter your API key for $PROVIDER_CHOICE"
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
