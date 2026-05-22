/**
 * Local Agent Loop — Multi-turn function-calling agent using
 * DeepSeek/Qwen OpenAI-compatible APIs.
 *
 * Injected by setup.sh into @claude-flow/cli dist as:
 *   dist/src/mcp-tools/local-agent-loop.js
 *
 * Provides: callAgentLoop(messages, options) → {result, turns, ...}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { join, resolve, relative, dirname } from 'node:path';
import { getProjectCwd } from './types.js';

// ============================================================================
// Tool Definitions — OpenAI Function Calling JSON Schema
// ============================================================================
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read file contents at the given path within the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative or absolute path within the project directory.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file within the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root.' },
          content: { type: 'string', description: 'File contents to write.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace a string in an existing file within the project.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root.' },
          old_string: { type: 'string', description: 'Exact text to replace.' },
          new_string: { type: 'string', description: 'Replacement text.' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Execute a shell command. Dangerous commands (rm -rf /, curl | bash, sudo, etc.) are rejected.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories within a project path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to project root. Defaults to root.' }
        },
        required: []
      }
    }
  }
];

// ============================================================================
// Tool Whitelist
// ============================================================================
const ALLOWED_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'run_bash', 'list_files']);

// ============================================================================
// Path Sandbox
// ============================================================================
function resolveSandboxPath(inputPath) {
  const projectRoot = resolve(getProjectCwd());
  const resolved = resolve(projectRoot, inputPath || '.');
  const rel = relative(projectRoot, resolved);
  if (rel.startsWith('..') || rel === '') {
    return { ok: false, resolved, rel, error: `Path traversal rejected: "${inputPath}" resolves outside project root.` };
  }
  return { ok: true, resolved, rel };
}

// ============================================================================
// Bash Safety
// ============================================================================
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\//,           // rm -rf /
  /\bcurl\b.*\|.*\b(bash|sh)\b/, // curl | bash
  /\bwget\b.*\|.*\b(bash|sh)\b/, // wget | bash
  />\s*\/dev\/sd[a-z]/,         // overwrite disk
  /\bchmod\s+777\s+\//,         // chmod 777 /
  /\bsudo\b/,                   // sudo
  /\bdd\s+if=/,                 // dd (disk destroyer)
  /\bmkfs\./,                   // mkfs
  /\b:\(\)\s*\{/,              // fork bomb
];

function isDangerousCommand(command) {
  return DANGEROUS_PATTERNS.some(p => p.test(command));
}

function execBash(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    if (isDangerousCommand(command)) {
      resolve({ success: false, stdout: '', stderr: '', error: `Dangerous command rejected: ${command.slice(0, 100)}` });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    exec(command, {
      cwd: getProjectCwd(),
      timeout: timeoutMs,
      signal: controller.signal,
      maxBuffer: 1024 * 1024, // 1MB
      encoding: 'utf-8',
      shell: '/bin/bash',
    }, (error, stdout, stderr) => {
      clearTimeout(timer);
      const out = (stdout || '').slice(0, 2000);
      const err = (stderr || '').slice(0, 2000);
      if (error) {
        if (error.killed || error.signal === 'SIGTERM') {
          resolve({ success: false, stdout: out.slice(0, 200), stderr: err.slice(0, 200), error: `Command timed out after ${timeoutMs}ms` });
        } else {
          resolve({ success: false, stdout: out.slice(0, 200), stderr: err.slice(0, 200), error: error.message });
        }
      } else {
        resolve({ success: true, stdout: out + (out.length >= 2000 ? '\n[truncated]' : ''), stderr: err + (err.length >= 2000 ? '\n[truncated]' : ''), error: null });
      }
    });
  });
}

// ============================================================================
// Tool Dispatcher
// ============================================================================
async function executeToolCall(toolName, toolArgs) {
  if (!ALLOWED_TOOLS.has(toolName)) {
    return { success: false, output: `Tool "${toolName}" is not in the whitelist. Available: ${[...ALLOWED_TOOLS].join(', ')}` };
  }

  try {
    switch (toolName) {
      case 'read_file': {
        const pathResult = resolveSandboxPath(toolArgs.path);
        if (!pathResult.ok) return { success: false, output: pathResult.error };
        const content = readFileSync(pathResult.resolved, 'utf-8');
        return { success: true, output: content.slice(0, 10000) + (content.length >= 10000 ? '\n[truncated]' : '') };
      }
      case 'write_file': {
        const pathResult = resolveSandboxPath(toolArgs.path);
        if (!pathResult.ok) return { success: false, output: pathResult.error };
        const dir = dirname(pathResult.resolved);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(pathResult.resolved, toolArgs.content, 'utf-8');
        return { success: true, output: `File written: ${pathResult.rel} (${toolArgs.content.length} bytes)` };
      }
      case 'edit_file': {
        const pathResult = resolveSandboxPath(toolArgs.path);
        if (!pathResult.ok) return { success: false, output: pathResult.error };
        if (!existsSync(pathResult.resolved)) return { success: false, output: `File not found: ${pathResult.rel}` };
        let content = readFileSync(pathResult.resolved, 'utf-8');
        if (!content.includes(toolArgs.old_string)) {
          return { success: false, output: `String not found in ${pathResult.rel}. The old_string must match exactly.` };
        }
        content = content.replace(toolArgs.old_string, toolArgs.new_string);
        writeFileSync(pathResult.resolved, content, 'utf-8');
        return { success: true, output: `File edited: ${pathResult.rel} (replaced 1 occurrence)` };
      }
      case 'run_bash': {
        const result = await execBash(toolArgs.command);
        return {
          success: result.success,
          output: result.success
            ? `stdout:\n${result.stdout || '(empty)'}\n${result.stderr ? `stderr:\n${result.stderr}` : ''}`
            : `error: ${result.error}`,
        };
      }
      case 'list_files': {
        const pathResult = resolveSandboxPath(toolArgs.path || '.');
        if (!pathResult.ok) return { success: false, output: pathResult.error };
        const entries = readdirSyncRecursive(pathResult.resolved, 3);
        return { success: true, output: entries.join('\n') || '(empty directory)' };
      }
      default:
        return { success: false, output: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, output: `Tool execution error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function readdirSyncRecursive(dir, maxDepth, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        results.push(entry + (s.isDirectory() ? '/' : ''));
        if (s.isDirectory()) {
          results.push(...readdirSyncRecursive(full, maxDepth, currentDepth + 1).map(e => '  '.repeat(currentDepth + 1) + e));
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip */ }
  return results;
}

// ============================================================================
// Checkpoint — Atomic write-tmp → rename
// ============================================================================
const CHECKPOINT_FILE = 'checkpoint.json';
const CHECKPOINT_TMP = 'checkpoint.tmp.json';

function saveCheckpoint(agentDir, state) {
  const tmp = join(agentDir, CHECKPOINT_TMP);
  const target = join(agentDir, CHECKPOINT_FILE);
  writeFileSync(tmp, JSON.stringify({
    ...state,
    lastCheckpointAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
  renameSync(tmp, target);
}

function loadCheckpoint(agentDir) {
  const target = join(agentDir, CHECKPOINT_FILE);
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(readFileSync(target, 'utf-8'));
  } catch {
    return null;
  }
}

// ============================================================================
// Transcript — Append-only event log
// ============================================================================
const TRANSCRIPT_FILE = 'transcript.json';

function appendTranscript(agentDir, event) {
  const target = join(agentDir, TRANSCRIPT_FILE);
  let events = [];
  if (existsSync(target)) {
    try { events = JSON.parse(readFileSync(target, 'utf-8')); } catch { /* start fresh */ }
  }
  events.push({ ...event, timestamp: new Date().toISOString() });
  writeFileSync(target, JSON.stringify(events, null, 2), 'utf-8');
}

function readTranscript(agentDir) {
  const target = join(agentDir, TRANSCRIPT_FILE);
  if (!existsSync(target)) return [];
  try { return JSON.parse(readFileSync(target, 'utf-8')); } catch { return []; }
}

// ============================================================================
// Hierarchical Summarization — Every 5 turns, compress old turns
// ============================================================================
const SUMMARY_INTERVAL = 5;
const KEEP_RECENT = 5;

async function maybeSummarize(apiMessages, turnCount, apiKey, provider) {
  if (turnCount <= SUMMARY_INTERVAL) return apiMessages;
  if (turnCount % SUMMARY_INTERVAL !== 0) return apiMessages;

  // Keep recent KEEP_RECENT user/assistant pairs verbatim
  const cutoff = Math.max(0, apiMessages.length - KEEP_RECENT * 2);
  const oldMessages = apiMessages.slice(0, cutoff);
  const recentMessages = apiMessages.slice(cutoff);

  // Compress old messages into a summary
  const summaryPrompt = [
    'Summarize the following agent conversation history. Keep:',
    '- All file paths created or modified',
    '- All command outputs (errors especially)',
    '- Current task state and next steps',
    '- Key decisions made',
    '',
    'Conversation:',
    ...oldMessages.map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 2000) : JSON.stringify(m.content).slice(0, 2000)}`),
    '',
    'Provide a concise summary in 2-3 paragraphs.',
  ].join('\n');

  try {
    const summary = await callFlashLLM(summaryPrompt, apiKey, provider);
    return [
      { role: 'system', content: `[Context summary of earlier turns]\n${summary}` },
      ...recentMessages,
    ];
  } catch {
    // If summarization fails, continue with full context (risk overflow)
    return apiMessages;
  }
}

async function callFlashLLM(summaryPrompt, apiKey, provider) {
  // Use callOpenAICompat for flash summarization
  const compatProvider = {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-v4-flash',
    apiKey: apiKey,
    provider: 'deepseek',
  };

  if (provider === 'deepseek') {
    compatProvider.baseURL = 'https://api.deepseek.com/v1';
  } else if (provider === 'qwen') {
    compatProvider.baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    compatProvider.name = 'Qwen';
    compatProvider.defaultModel = 'qwen3.6-flash';
    compatProvider.provider = 'qwen';
  }

  const url = compatProvider.baseURL + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: compatProvider.defaultModel,
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'user', content: summaryPrompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Flash LLM error: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ============================================================================
// Main Loop: callAgentLoop
// ============================================================================
export async function callAgentLoop(options) {
  const {
    prompt,
    systemPrompt,
    model = 'deepseek-v4-flash',
    provider = 'deepseek',
    apiKey,
    agentDir,
    maxTurns = 50,
    warnAtTurn = 15,
    onProgress,
  } = options;

  // Pick API endpoint based on provider
  let apiUrl, headers, bodyModel;
  if (provider === 'deepseek') {
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    bodyModel = model;
  } else if (provider === 'qwen') {
    apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
    headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    bodyModel = model || 'qwen3.6-plus';
  } else {
    // Generic OpenAI-compatible
    apiUrl = provider.startsWith('http') ? provider + '/chat/completions' : `https://api.deepseek.com/v1/chat/completions`;
    headers = { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
    bodyModel = model;
  }

  // Build initial messages
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  let turnCount = 0;
  let lastOutput = '';
  let totalTokens = { input: 0, output: 0 };

  // Transcript: start event
  if (agentDir) {
    appendTranscript(agentDir, { type: 'agent.start', prompt: prompt.slice(0, 500) });
  }

  while (turnCount < maxTurns) {
    turnCount++;

    // Context summarization
    const processedMessages = await maybeSummarize(messages, turnCount, apiKey, provider);

    // Token budget protection
    const totalChars = JSON.stringify(processedMessages).length;
    if (totalChars > 50000) {
      const err = `Context too large (${totalChars} chars). Consider a smaller task.`;
      if (agentDir) appendTranscript(agentDir, { type: 'agent.error', error: err });
      return { success: false, error: err, turns: turnCount, output: lastOutput };
    }

    // Warn at threshold
    if (turnCount === warnAtTurn) {
      if (agentDir) appendTranscript(agentDir, { type: 'agent.warning', message: `Reached ${warnAtTurn} turns` });
    }

    if (onProgress) {
      onProgress({ turnCount, status: 'thinking' });
    }

    // Call LLM
    let llmResponse;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000); // 2 min per turn
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: bodyModel,
          max_tokens: 4096,
          temperature: 0.7,
          messages: processedMessages,
          tools: TOOLS,
          tool_choice: 'auto',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const errText = await res.text().catch(() => '<unreadable>');
        const err = `LLM API error ${res.status}: ${errText.slice(0, 400)}`;
        if (agentDir) appendTranscript(agentDir, { type: 'agent.error', error: err });
        return { success: false, error: err, turns: turnCount, output: lastOutput };
      }
      llmResponse = await res.json();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (agentDir) appendTranscript(agentDir, { type: 'agent.error', error: msg });
      return { success: false, error: msg, turns: turnCount, output: lastOutput };
    }

    const choice = llmResponse.choices?.[0];
    if (!choice) {
      const err = 'No response from LLM';
      if (agentDir) appendTranscript(agentDir, { type: 'agent.error', error: err });
      return { success: false, error: err, turns: turnCount, output: lastOutput };
    }

    // Track usage
    if (llmResponse.usage) {
      totalTokens.input += llmResponse.usage.prompt_tokens || 0;
      totalTokens.output += llmResponse.usage.completion_tokens || 0;
    }

    const msg = choice.message;

    // No tool calls → final response
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      lastOutput = msg.content || '';
      messages.push({ role: 'assistant', content: lastOutput });

      if (agentDir) {
        appendTranscript(agentDir, { type: 'agent.complete', output: lastOutput.slice(0, 1000), turns: turnCount });
        saveCheckpoint(agentDir, {
          messages: messages.slice(-20), // Keep last 20 for resume context
          turnCount,
          totalTokens,
          status: 'idle',
          lastOutput: lastOutput.slice(0, 2000),
        });
      }

      return {
        success: true,
        output: lastOutput,
        turns: turnCount,
        totalTokens,
        model: llmResponse.model || bodyModel,
      };
    }

    // Execute tool calls
    const toolResults = [];
    const toolCalls = msg.tool_calls;

    // Add assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    // Execute tools in parallel
    const executions = toolCalls.map(async (tc) => {
      let args;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        return { tool_call_id: tc.id, role: 'tool', content: `Invalid JSON arguments: ${tc.function.arguments}` };
      }

      if (onProgress) {
        onProgress({ turnCount, status: 'executing', tool: tc.function.name });
      }

      const result = await executeToolCall(tc.function.name, args);
      const content = result.output || JSON.stringify(result);

      if (agentDir) {
        appendTranscript(agentDir, {
          type: 'agent.tool_call',
          tool: tc.function.name,
          args: JSON.stringify(args).slice(0, 500),
          result: content.slice(0, 500),
          success: result.success,
        });
      }

      return { tool_call_id: tc.id, role: 'tool', content };
    });

    const results = await Promise.all(executions);
    toolResults.push(...results);

    // Append tool results to messages
    messages.push(...results);

    // Save checkpoint
    if (agentDir) {
      saveCheckpoint(agentDir, {
        messages: messages.slice(-20),
        turnCount,
        totalTokens,
        status: 'running',
        lastOutput: results[results.length - 1]?.content?.slice(0, 500) || '',
      });
    }
  }

  // Max turns reached
  const err = `Reached max turns (${maxTurns}). Returning partial results.`;
  if (agentDir) {
    appendTranscript(agentDir, { type: 'agent.timeout', turns: turnCount });
    saveCheckpoint(agentDir, {
      messages: messages.slice(-20),
      turnCount,
      totalTokens,
      status: 'timeout',
      lastOutput,
    });
  }
  return { success: false, error: err, turns: turnCount, output: lastOutput, partial: true };
}
