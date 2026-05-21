/**
 * Shared agent-execution core.
 *
 * Both the agent_execute MCP tool and the workflow runtime (G3) need
 * to dispatch a prompt to an agent's configured Anthropic model. This
 * module factors that path out so it's testable and reusable, and
 * keeps the wire from agent_spawn → ProviderManager (real) in one
 * place rather than duplicated.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';

const STORAGE_DIR = '.claude-flow';
const AGENT_DIR = 'agents';
const AGENT_FILE = 'store.json';

type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';

// ---------------------------------------------------------------------------
// Multi-provider routing (ADR-026, #1725, #1906)
// ---------------------------------------------------------------------------

type ProviderType = 'deepseek' | 'qwen' | 'kimi' | 'zhipu' | 'doubao' | 'ollama' | 'anthropic';

interface ProviderEntry {
  name: string;
  provider: ProviderType;
  /** Env var checked for auto-detection */
  envKey: string;
  /** API base URL (without trailing path segments) */
  baseURL: string;
  /** Protocol: 'anthropic' (Messages API) or 'openai' (chat/completions) */
  protocol: 'anthropic' | 'openai';
  /** Auth header name */
  authHeader: string;
  /** Auth header value prefix (e.g. 'x-api-key' uses raw key, 'Bearer' prefixes) */
  authPrefix: string;
  /** Model IDs mapped by logical tier */
  models: { haiku: string; sonnet: string; opus: string };
}

const PROVIDERS: ProviderEntry[] = [
  {
    name: 'DeepSeek',
    provider: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com/anthropic',
    protocol: 'anthropic',
    authHeader: 'x-api-key',
    authPrefix: '',
    models: { haiku: 'deepseek-v4-flash', sonnet: 'deepseek-v4-flash', opus: 'deepseek-v4-pro' },
  },
  {
    name: 'Qwen',
    provider: 'qwen',
    envKey: 'DASHSCOPE_API_KEY',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    protocol: 'openai',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    models: { haiku: 'qwen3.6-flash', sonnet: 'qwen3.6-plus', opus: 'qwen3.6-max-preview' },
  },
  {
    name: 'Kimi',
    provider: 'kimi',
    envKey: 'MOONSHOT_API_KEY',
    baseURL: 'https://api.moonshot.cn/v1',
    protocol: 'openai',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    models: { haiku: 'kimi-k2-turbo-preview', sonnet: 'kimi-k2.6', opus: 'kimi-k2.6' },
  },
  {
    name: 'Zhipu',
    provider: 'zhipu',
    envKey: 'ZHIPU_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    protocol: 'openai',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    models: { haiku: 'GLM-4.7-Flash', sonnet: 'GLM-5', opus: 'GLM-5.1' },
  },
  {
    name: 'Doubao',
    provider: 'doubao',
    envKey: 'ARK_API_KEY',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    protocol: 'openai',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    models: { haiku: 'doubao-lite-32k', sonnet: 'doubao-pro-32k', opus: 'doubao-pro-32k' },
  },
];

interface ResolvedProvider {
  entry: ProviderEntry;
  apiKey: string;
  model: string;
}

/**
 * Auto-detect the best available provider from environment variables.
 *
 * Priority: RUFLO_PROVIDER override → DeepSeek → Qwen → Kimi → Zhipu →
 * Doubao → Ollama → Anthropic.
 *
 * Returns undefined when no provider is configured (caller falls back to
 * Anthropic / Ollama legacy paths).
 */
function detectProvider(modelInput?: string): ResolvedProvider | undefined {
  const explicit = (process.env.RUFLO_PROVIDER || '').toLowerCase();
  const tier = mapModelTier(modelInput);

  if (explicit && explicit !== 'ollama' && explicit !== 'anthropic') {
    // Explicit provider selection
    const entry = PROVIDERS.find(
      (p) => p.provider === explicit || p.name.toLowerCase() === explicit,
    );
    if (entry) {
      const key = process.env[entry.envKey];
      if (key) return { entry, apiKey: key, model: entry.models[tier] };
    }
    // Explicit provider selected but key missing → fall through to auto-detect
  }

  // Auto-detect by scanning env vars in priority order
  for (const entry of PROVIDERS) {
    const key = process.env[entry.envKey];
    if (key) return { entry, apiKey: key, model: entry.models[tier] };
  }

  return undefined;
}

/** Map a model input string to a logical tier for provider model selection. */
function mapModelTier(input?: string): 'haiku' | 'sonnet' | 'opus' {
  if (!input) return 'sonnet';
  const m = input.toLowerCase();
  if (m === 'haiku') return 'haiku';
  if (m === 'sonnet' || m === 'inherit') return 'sonnet';
  if (m === 'opus') return 'opus';
  // Direct model ID — try to infer tier from known patterns
  if (m.includes('flash') || m.includes('lite') || m.includes('turbo')) return 'haiku';
  if (m.includes('pro') || m.includes('max') || m.includes('opus') || m.includes('5.1') || m.includes('k2.6')) return 'opus';
  return 'sonnet';
}

/**
 * Call an OpenAI-compatible chat/completions endpoint.
 *
 * Translates Anthropic-flavored input to OpenAI format, calls the
 * provider's endpoint, and translates the response back so callers
 * never see provider-specific shapes.
 */
async function callOpenAICompat(
  input: AnthropicCallInput,
  resolved: ResolvedProvider,
): Promise<AnthropicCallResult> {
  const { entry, apiKey, model } = resolved;
  const url = `${entry.baseURL}/chat/completions`;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs || 60000);

    const messages: Array<{ role: string; content: string }> = [];
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt });
    }
    messages.push({ role: 'user', content: input.prompt });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        [entry.authHeader]: `${entry.authPrefix}${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens || 1024,
        temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable error body>');
      return {
        success: false,
        model,
        error: `${entry.name} API error ${res.status}: ${errText.slice(0, 400)}`,
      };
    }

    const data = (await res.json()) as {
      id?: string;
      model?: string;
      choices: Array<{ message: { role: string; content: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const textOut = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};

    return {
      success: true,
      model: data.model ?? model,
      messageId: data.id ?? `${entry.provider}-${Date.now()}`,
      stopReason: data.choices?.[0]?.finish_reason ?? 'stop',
      output: textOut,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

export interface AgentRecord {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'terminated';
  health: number;
  taskCount: number;
  config: Record<string, unknown>;
  createdAt: string;
  domain?: string;
  model?: ClaudeModel;
  modelRoutedBy?: 'explicit' | 'router' | 'agent-booster' | 'default';
  lastResult?: Record<string, unknown>;
}

interface AgentStore {
  agents: Record<string, AgentRecord>;
  version: string;
}

function getAgentDir(): string { return join(getProjectCwd(), STORAGE_DIR, AGENT_DIR); }
function getAgentPath(): string { return join(getAgentDir(), AGENT_FILE); }
function ensureAgentDir(): void {
  const dir = getAgentDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
function loadAgentStore(): AgentStore {
  try {
    if (existsSync(getAgentPath())) return JSON.parse(readFileSync(getAgentPath(), 'utf-8'));
  } catch { /* fall through */ }
  return { agents: {}, version: '3.0.0' };
}
function saveAgentStore(store: AgentStore): void {
  ensureAgentDir();
  writeFileSync(getAgentPath(), JSON.stringify(store, null, 2), 'utf-8');
}

// #1906 — these were stuck on Claude-3.x ids that the Anthropic API now
// 404s. Current model ids (Claude 4.x family):
//   Opus 4.7    → claude-opus-4-7
//   Sonnet 4.6  → claude-sonnet-4-6
//   Haiku 4.5   → claude-haiku-4-5-20251001
// `inherit` and the various defaults below all map to Sonnet 4.6.
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MODEL_MAP: Record<string, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
  inherit: DEFAULT_ANTHROPIC_MODEL,
};

export interface AnthropicCallInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;          // already-resolved Anthropic model id (e.g. 'claude-sonnet-4-6')
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AnthropicCallResult {
  success: boolean;
  model?: string;
  messageId?: string;
  stopReason?: string;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs?: number;
  error?: string;
}

/**
 * Generic Anthropic Messages API call. No agent registry coupling — used
 * by agent_execute (with the agent's configured model) and by the WASM
 * agent runtime (G4) when the bundled WASM only echoes input.
 *
 * #1725 — falls back to Ollama Cloud (Tier-2, OpenAI-compat) when
 * ANTHROPIC_API_KEY is unset and OLLAMA_API_KEY is present, or when
 * RUFLO_PROVIDER=ollama is explicitly set. Response shape is normalized
 * to the Anthropic-flavored AnthropicCallResult so existing callers
 * don't need to know which provider answered.
 */
export async function callAnthropicMessages(input: AnthropicCallInput): Promise<AnthropicCallResult> {
  // --- Tier-1: Multi-provider auto-detection (DeepSeek, Qwen, Kimi, Zhipu, Doubao) ---
  const resolved = detectProvider(input.model);
  if (resolved) {
    if (resolved.entry.protocol === 'anthropic') {
      // DeepSeek uses Anthropic-compatible Messages API
      return callDeepSeekMessages(input, resolved);
    }
    // OpenAI-compatible providers (Qwen, Kimi, Zhipu, Doubao)
    return callOpenAICompat(input, resolved);
  }

  // --- Tier-2: Ollama Cloud fallback (legacy #1725) ---
  const explicitProvider = (process.env.RUFLO_PROVIDER || '').toLowerCase();
  const ollamaKey = process.env.OLLAMA_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const useOllama =
    explicitProvider === 'ollama' || (!anthropicKey && !!ollamaKey);

  if (useOllama && ollamaKey) {
    return callOllamaCompat({ ...input, apiKey: ollamaKey });
  }
  if (!anthropicKey) {
    return {
      success: false,
      error:
        'No LLM provider configured. Set one of: DEEPSEEK_API_KEY, DASHSCOPE_API_KEY, MOONSHOT_API_KEY, ZHIPU_API_KEY, ARK_API_KEY, OLLAMA_API_KEY, or ANTHROPIC_API_KEY.',
    };
  }

  // --- Tier-3: Native Anthropic API ---
  const model = input.model || DEFAULT_ANTHROPIC_MODEL;
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs || 60000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens || 1024,
        temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        messages: [{ role: 'user', content: input.prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable error body>');
      return { success: false, model, error: `Anthropic API error ${res.status}: ${errText.slice(0, 400)}` };
    }
    const data = await res.json() as {
      id: string;
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    const textOut = data.content
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text as string)
      .join('');
    return {
      success: true,
      model: data.model,
      messageId: data.id,
      stopReason: data.stop_reason,
      output: textOut,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * DeepSeek Anthropic-compatible Messages API call.
 *
 * DeepSeek speaks the Anthropic Messages wire format natively, so we
 * can use the same request/response shapes as the Anthropic path.
 * Endpoint: https://api.deepseek.com/anthropic/v1/messages
 * Auth: x-api-key (same header name as Anthropic)
 */
async function callDeepSeekMessages(
  input: AnthropicCallInput,
  resolved: ResolvedProvider,
): Promise<AnthropicCallResult> {
  const { apiKey, model } = resolved;
  const startedAt = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs || 60000);
    const res = await fetch(`${resolved.entry.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens || 1024,
        temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
        messages: [{ role: 'user', content: input.prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable error body>');
      return {
        success: false,
        model,
        error: `DeepSeek API error ${res.status}: ${errText.slice(0, 400)}`,
      };
    }

    const data = await res.json() as {
      id: string;
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textOut = data.content
      .filter(c => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text as string)
      .join('');

    return {
      success: true,
      model: data.model,
      messageId: data.id,
      stopReason: data.stop_reason,
      output: textOut,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Ollama Cloud / OpenAI-compat provider — Tier-2 routing per ADR-026 + #1725.
 *
 * Endpoint: https://ollama.com/v1/chat/completions
 * Auth: Authorization: Bearer <OLLAMA_API_KEY>
 *
 * Translates the Anthropic-flavored input shape onto OpenAI chat-completions
 * and translates the response back so callers never see provider-specific
 * fields. Logical model names are mapped to Ollama Cloud defaults:
 *   - 'haiku'  / 'sonnet'  → 'gpt-oss:120b-cloud' (sensible single default)
 *   - 'opus'              → 'gpt-oss:120b-cloud' (no opus tier on Ollama)
 *   - explicit 'ollama:<model>' or bare provider-native name → passed through
 */
async function callOllamaCompat(
  input: AnthropicCallInput & { apiKey: string },
): Promise<AnthropicCallResult> {
  const model = resolveOllamaModel(input.model);
  const startedAt = Date.now();
  // OLLAMA_BASE_URL lets users point at local/self-hosted endpoints
  // (e.g. http://ruvultra:11434, http://localhost:11434) instead of
  // Ollama Cloud. Default is the public cloud endpoint.
  const base = (process.env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
  const url = `${base}/v1/chat/completions`;
  // Self-hosted endpoints typically don't need an Authorization header
  // (the daemon binds to 11434 with no auth by default), but Ollama Cloud
  // does. Send the bearer when the key is non-empty AND looks cloud-shaped.
  const sendAuth = input.apiKey && input.apiKey !== 'local';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs || 60000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...(sendAuth ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens || 1024,
        temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
        messages: [
          ...(input.systemPrompt
            ? [{ role: 'system' as const, content: input.systemPrompt }]
            : []),
          { role: 'user' as const, content: input.prompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '<unreadable error body>');
      return { success: false, model, error: `Ollama API error ${res.status} at ${url}: ${errText.slice(0, 400)}` };
    }
    const data = (await res.json()) as {
      id?: string;
      model?: string;
      choices: Array<{
        message: { role: string; content: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const textOut = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    return {
      success: true,
      model: data.model ?? model,
      messageId: data.id ?? `ollama-${Date.now()}`,
      stopReason: data.choices?.[0]?.finish_reason ?? 'end_turn',
      output: textOut,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      success: false,
      model,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

function resolveOllamaModel(input: string | undefined): string {
  const DEFAULT = 'gpt-oss:120b-cloud';
  if (!input) return DEFAULT;
  // Logical → cloud default
  if (input === 'haiku' || input === 'sonnet' || input === 'opus' || input === 'inherit') {
    return DEFAULT;
  }
  // Explicit provider prefix
  if (input.startsWith('ollama:')) return input.slice('ollama:'.length);
  // Bare name with cloud suffix (e.g. 'llama3:70b-cloud') passes through
  return input;
}

/**
 * Resolve a model identifier to an Anthropic model ID. Accepts:
 * - logical names: 'haiku', 'sonnet', 'opus', 'inherit'
 * - prefixed: 'anthropic:claude-sonnet-4-6'
 * - direct: 'claude-sonnet-4-6'
 */
export function resolveAnthropicModel(input: string | undefined): string {
  if (!input) return DEFAULT_ANTHROPIC_MODEL;
  if (input in MODEL_MAP) return MODEL_MAP[input];
  if (input.startsWith('anthropic:')) return input.slice('anthropic:'.length);
  return input;
}

export interface AgentExecuteInput {
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AgentExecuteResult {
  success: boolean;
  agentId: string;
  model?: string;
  messageId?: string;
  stopReason?: string;
  output?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  durationMs?: number;
  error?: string;
  remediation?: string;
}

export async function executeAgentTask(input: AgentExecuteInput): Promise<AgentExecuteResult> {
  // Detect available provider (multi-provider → Ollama → Anthropic)
  const resolved = detectProvider();
  if (!resolved && !process.env.ANTHROPIC_API_KEY && !process.env.OLLAMA_API_KEY) {
    return {
      success: false,
      agentId: input.agentId,
      error: 'No LLM provider API key set. Configure one of: DEEPSEEK_API_KEY, DASHSCOPE_API_KEY, MOONSHOT_API_KEY, ZHIPU_API_KEY, ARK_API_KEY, OLLAMA_API_KEY, or ANTHROPIC_API_KEY.',
      remediation: 'Set the appropriate env var for your provider and re-run.',
    };
  }

  const store = loadAgentStore();
  const agent = store.agents[input.agentId];
  if (!agent) return { success: false, agentId: input.agentId, error: 'Agent not found' };
  if (agent.status === 'terminated') return { success: false, agentId: input.agentId, error: 'Agent has been terminated' };

  const systemPrompt = input.systemPrompt ||
    `You are a ${agent.agentType} agent operating as part of a Ruflo swarm. ` +
    `Agent ID: ${input.agentId}. Domain: ${agent.domain ?? 'general'}. ` +
    `Respond directly and stay focused on the task. If you need information you don't have, state that explicitly.`;

  agent.status = 'busy';
  agent.taskCount = (agent.taskCount || 0) + 1;
  saveAgentStore(store);

  const startedAt = Date.now();

  // Route to the appropriate provider
  let result: AnthropicCallResult;
  const logicalModel = agent.model || 'sonnet';
  const anthropicModel = MODEL_MAP[logicalModel] || DEFAULT_ANTHROPIC_MODEL;

  try {
    if (resolved) {
      // Multi-provider path (DeepSeek, Qwen, Kimi, Zhipu, Doubao)
      result = await callAnthropicMessages({
        prompt: input.prompt,
        systemPrompt,
        model: logicalModel, // detectProvider will map to native model
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        timeoutMs: input.timeoutMs,
      });
    } else {
      // Legacy Anthropic / Ollama path
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const ollamaKey = process.env.OLLAMA_API_KEY;
      const useOllama = !apiKey && !!ollamaKey;

      if (useOllama && ollamaKey) {
        result = await callOllamaCompat({
          prompt: input.prompt,
          systemPrompt,
          model: logicalModel,
          maxTokens: input.maxTokens,
          temperature: input.temperature,
          timeoutMs: input.timeoutMs,
          apiKey: ollamaKey,
        });
      } else if (apiKey) {
        const controller = new AbortController();
        const timeoutMs = input.timeoutMs || 60000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: anthropicModel,
            max_tokens: input.maxTokens || 1024,
            temperature: typeof input.temperature === 'number' ? input.temperature : 0.7,
            system: systemPrompt,
            messages: [{ role: 'user', content: input.prompt }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text().catch(() => '<unreadable error body>');
          result = {
            success: false,
            model: anthropicModel,
            error: `Anthropic API error ${res.status}: ${errText.slice(0, 400)}`,
          };
        } else {
          const data = await res.json() as {
            id: string;
            model: string;
            content: Array<{ type: string; text?: string }>;
            stop_reason: string;
            usage: { input_tokens: number; output_tokens: number };
          };
          const textOut = data.content
            .filter(c => c.type === 'text' && typeof c.text === 'string')
            .map(c => c.text as string)
            .join('');
          result = {
            success: true,
            model: data.model,
            messageId: data.id,
            stopReason: data.stop_reason,
            output: textOut,
            usage: {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
              totalTokens: data.usage.input_tokens + data.usage.output_tokens,
            },
            durationMs: Date.now() - startedAt,
          };
        }
      } else {
        result = { success: false, model: anthropicModel, error: 'No API key configured' };
      }
    }

    if (result.success) {
      const agentResult: AgentExecuteResult = {
        success: true,
        agentId: input.agentId,
        messageId: result.messageId,
        model: result.model,
        stopReason: result.stopReason,
        output: result.output,
        usage: result.usage,
        durationMs: result.durationMs || (Date.now() - startedAt),
      };

      agent.status = 'idle';
      agent.lastResult = agentResult as unknown as Record<string, unknown>;
      saveAgentStore(store);
      return agentResult;
    }

    agent.status = 'idle';
    saveAgentStore(store);
    return {
      success: false,
      agentId: input.agentId,
      model: result.model,
      error: result.error,
    };
  } catch (err) {
    agent.status = 'idle';
    saveAgentStore(store);
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      agentId: input.agentId,
      model: anthropicModel,
      error: `agent_execute failed: ${msg}`,
      durationMs: Date.now() - startedAt,
    };
  }
}
