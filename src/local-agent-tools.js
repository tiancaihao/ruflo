/**
 * Local Agent MCP Tools — Local agent lifecycle tools mirroring
 * managed_agent_* API, but executing locally via DeepSeek/Qwen
 * function calling instead of Anthropic's cloud API.
 *
 * Injected by setup.sh into @claude-flow/cli dist as:
 *   dist/src/mcp-tools/local-agent-tools.js
 *
 * Lifecycle:
 *   local_agent_create    → mkdir .claude-flow/agents/{id}/ + init checkpoint
 *   local_agent_prompt    → callAgentLoop (sync or async)
 *   local_agent_status    → read checkpoint.json
 *   local_agent_events    → read transcript.json
 *   local_agent_list      → list .claude-flow/agents/
 *   local_agent_terminate → delete agent directory
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';

// Injected by setup.sh — resolves at import time in the patched dist
let _callAgentLoop = null;
async function getCallAgentLoop() {
  if (_callAgentLoop) return _callAgentLoop;
  const mod = await import('./local-agent-loop.js');
  _callAgentLoop = mod.callAgentLoop;
  return _callAgentLoop;
}

// ============================================================================
// Agent Storage
// ============================================================================
const STORAGE_DIR = '.claude-flow';
const AGENTS_DIR = 'agents';

function getAgentsDir() {
  return join(getProjectCwd(), STORAGE_DIR, AGENTS_DIR);
}

function getAgentDir(agentId) {
  return join(getAgentsDir(), agentId);
}

function ensureAgentsDir() {
  const dir = getAgentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Running async loops (in-memory tracking)
// ============================================================================
const runningLoops = new Map();
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_LOCAL_AGENTS || '3', 10);
const loopQueue = [];

function enqueueLoop(task) {
  if (runningLoops.size < MAX_CONCURRENT) {
    startLoop(task);
    return { status: 'started', position: 0 };
  }
  loopQueue.push(task);
  return { status: 'queued', position: loopQueue.length };
}

function startLoop(task) {
  runningLoops.set(task.taskId, task);
  task.run().finally(() => {
    runningLoops.delete(task.taskId);
    // Dequeue next
    const next = loopQueue.shift();
    if (next) {
      next.dequeuedPosition = next.position;
      startLoop(next);
    }
  });
}

function getQueueStatus(taskId) {
  if (runningLoops.has(taskId)) return 'running';
  const idx = loopQueue.findIndex(t => t.taskId === taskId);
  if (idx >= 0) return `queued:${idx + 1}`;
  return 'unknown';
}

// ============================================================================
// Provider resolution
// ============================================================================
function resolveProvider() {
  const explicit = (process.env.RUFLO_PROVIDER || '').toLowerCase();
  const dsKey = process.env.DEEPSEEK_API_KEY;
  const qwenKey = process.env.DASHSCOPE_API_KEY;

  if (explicit === 'deepseek' && dsKey) return { provider: 'deepseek', apiKey: dsKey, model: 'deepseek-v4-flash' };
  if (explicit === 'qwen' && qwenKey) return { provider: 'qwen', apiKey: qwenKey, model: 'qwen3.6-plus' };
  if (dsKey) return { provider: 'deepseek', apiKey: dsKey, model: 'deepseek-v4-flash' };
  if (qwenKey) return { provider: 'qwen', apiKey: qwenKey, model: 'qwen3.6-plus' };
  return null;
}

// ============================================================================
// Tool Definitions
// ============================================================================
export const localAgentTools = [
  // ---- local_agent_create ----
  {
    name: 'local_agent_create',
    description: 'Create a new local agent instance. Returns an agentId for use with local_agent_prompt.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the agent.' },
        model: {
          type: 'string',
          enum: ['flash', 'sonnet', 'pro', 'deepseek-v4-flash', 'deepseek-v4-pro', 'qwen3.6-flash', 'qwen3.6-plus', 'qwen3.6-max-preview'],
          description: 'Model to use for LLM calls. Default: "flash".'
        },
        instructions: { type: 'string', description: 'System prompt / instructions for the agent.' },
      },
      required: ['name']
    },
    async handler(args) {
      const providerInfo = resolveProvider();
      if (!providerInfo) {
        return { success: false, error: 'No LLM provider configured. Set DEEPSEEK_API_KEY or DASHSCOPE_API_KEY.' };
      }

      try {
        ensureAgentsDir();
        const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const agentDir = getAgentDir(id);
        mkdirSync(agentDir, { recursive: true });

        const checkpoint = {
          agentId: id,
          name: args.name,
          model: args.model || 'flash',
          instructions: args.instructions || 'You are a helpful coding assistant with access to local tools.',
          provider: providerInfo.provider,
          createdAt: new Date().toISOString(),
          status: 'idle',
          messages: [],
          turnCount: 0,
          totalTokens: { input: 0, output: 0 },
        };
        writeFileSync(join(agentDir, 'checkpoint.json'), JSON.stringify(checkpoint, null, 2), 'utf-8');
        writeFileSync(join(agentDir, 'transcript.json'), '[]', 'utf-8');

        return {
          success: true,
          agentId: id,
          name: args.name,
          model: checkpoint.model,
          provider: checkpoint.provider,
          createdAt: checkpoint.createdAt,
        };
      } catch (err) {
        return { success: false, error: `Failed to create agent: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  },

  // ---- local_agent_prompt ----
  {
    name: 'local_agent_prompt',
    description: 'Send a prompt to a local agent. Runs a multi-turn tool-execution loop locally. Set async:true for background execution.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID returned by local_agent_create.' },
        prompt: { type: 'string', description: 'The task prompt to send.' },
        async: { type: 'boolean', description: 'Run in background. Default: false.' },
        resume: { type: 'string', enum: ['resume', 'reset', 'continue'], description: 'Checkpoint recovery mode. "resume": continue from checkpoint. "reset": delete and restart. "continue": keep context, add prompt.' },
      },
      required: ['agentId', 'prompt']
    },
    async handler(args) {
      const agentDir = getAgentDir(args.agentId);
      if (!existsSync(agentDir)) {
        return { success: false, error: `Agent not found: ${args.agentId}` };
      }

      const providerInfo = resolveProvider();
      if (!providerInfo) {
        return { success: false, error: 'No LLM provider configured. Set DEEPSEEK_API_KEY or DASHSCOPE_API_KEY.' };
      }

      const checkpointPath = join(agentDir, 'checkpoint.json');
      let checkpoint = null;
      if (existsSync(checkpointPath)) {
        try { checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8')); } catch { /* stale checkpoint */ }
      }

      // Handle resume/continue/reset
      let systemPrompt = checkpoint?.instructions || 'You are a helpful coding assistant with access to local tools.';
      let prompt = args.prompt;

      if (args.resume && checkpoint) {
        if (args.resume === 'reset') {
          checkpoint = null;
          writeFileSync(join(agentDir, 'transcript.json'), '[]', 'utf-8');
        } else if (args.resume === 'continue') {
          prompt = prompt; // keep context, add new prompt
        }
        // 'resume' is default — just continue from checkpoint
      }

      // Determine model from checkpoint or args
      let model = providerInfo.model;
      if (checkpoint?.model) {
        const modelMap = {
          flash: 'deepseek-v4-flash',
          sonnet: 'deepseek-v4-pro',
          pro: 'deepseek-v4-pro',
        };
        model = modelMap[checkpoint.model] || checkpoint.model || model;
      }

      const loopOptions = {
        prompt,
        systemPrompt,
        model,
        provider: providerInfo.provider,
        apiKey: providerInfo.apiKey,
        agentDir,
        maxTurns: 50,
        warnAtTurn: 15,
      };

      // Async mode
      if (args.async) {
        const taskId = args.agentId + '-task-' + Date.now().toString(36);

        const task = {
          taskId,
          agentId: args.agentId,
          position: 0,
          run: async () => {
            const callAgentLoop = await getCallAgentLoop();
            const result = await callAgentLoop(loopOptions);
            // Update checkpoint with final state
            if (existsSync(checkpointPath)) {
              try {
                const cp = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
                cp.status = result.success ? 'idle' : 'error';
                cp.lastResult = result.output?.slice(0, 1000) || '';
                cp.turns = result.turns;
                writeFileSync(checkpointPath, JSON.stringify(cp, null, 2), 'utf-8');
              } catch { /* best-effort */ }
            }
            return result;
          },
        };

        const started = enqueueLoop(task);
        return {
          success: true,
          taskId,
          agentId: args.agentId,
          status: started.status,
          position: started.position,
          message: started.status === 'queued'
            ? `Queued at position ${started.position}. ${MAX_CONCURRENT} loops already running.`
            : 'Agent loop started in background. Check progress with local_agent_status.',
        };
      }

      // Sync mode
      const callAgentLoop = await getCallAgentLoop();
      const result = await callAgentLoop(loopOptions);

      if (result.success) {
        return {
          success: true,
          agentId: args.agentId,
          output: result.output,
          turns: result.turns,
          totalTokens: result.totalTokens,
          model: result.model,
        };
      }
      return {
        success: false,
        agentId: args.agentId,
        error: result.error,
        turns: result.turns,
        partialOutput: result.output,
      };
    }
  },

  // ---- local_agent_status ----
  {
    name: 'local_agent_status',
    description: 'Get the current status and progress of a local agent.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID.' },
      },
      required: ['agentId']
    },
    async handler(args) {
      const agentDir = getAgentDir(args.agentId);
      if (!existsSync(agentDir)) {
        return { success: false, error: `Agent not found: ${args.agentId}` };
      }

      const checkpointPath = join(agentDir, 'checkpoint.json');
      if (!existsSync(checkpointPath)) {
        return { success: true, agentId: args.agentId, status: 'created', message: 'Agent exists but has no checkpoint.' };
      }

      let checkpoint;
      try { checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8')); } catch {
        return { success: false, error: 'Corrupted checkpoint file.' };
      }

      // Check if there's a running async loop
      const taskId = args.agentId + '-task-';
      let loopStatus = 'idle';
      for (const [tid] of runningLoops) {
        if (tid.startsWith(taskId)) { loopStatus = 'running'; break; }
      }
      if (loopStatus === 'idle') {
        loopStatus = getQueueStatus(taskId) === 'running' ? 'running' : 'idle';
      }

      return {
        success: true,
        agentId: args.agentId,
        name: checkpoint.name,
        status: loopStatus === 'running' ? 'running' : checkpoint.status || 'idle',
        model: checkpoint.model,
        currentTurn: checkpoint.turnCount || 0,
        lastOutput: checkpoint.lastOutput?.slice(0, 500) || '',
        totalTokens: checkpoint.totalTokens || { input: 0, output: 0 },
        createdAt: checkpoint.createdAt,
        lastCheckpointAt: checkpoint.lastCheckpointAt,
      };
    }
  },

  // ---- local_agent_events ----
  {
    name: 'local_agent_events',
    description: 'Get the full transcript/event history of a local agent.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID.' },
        limit: { type: 'number', description: 'Max events to return. Default: all.' },
      },
      required: ['agentId']
    },
    async handler(args) {
      const agentDir = getAgentDir(args.agentId);
      if (!existsSync(agentDir)) {
        return { success: false, error: `Agent not found: ${args.agentId}` };
      }

      const transcriptPath = join(agentDir, 'transcript.json');
      if (!existsSync(transcriptPath)) {
        return { success: true, agentId: args.agentId, events: [], count: 0 };
      }

      let events;
      try { events = JSON.parse(readFileSync(transcriptPath, 'utf-8')); } catch {
        return { success: true, agentId: args.agentId, events: [], count: 0 };
      }

      if (args.limit && args.limit > 0) {
        events = events.slice(-args.limit);
      }

      return {
        success: true,
        agentId: args.agentId,
        events,
        count: events.length,
      };
    }
  },

  // ---- local_agent_list ----
  {
    name: 'local_agent_list',
    description: 'List all local agents.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    },
    async handler() {
      const agentsDir = getAgentsDir();
      if (!existsSync(agentsDir)) {
        return { success: true, agents: [] };
      }

      const agents = [];
      try {
        for (const entry of readdirSync(agentsDir)) {
          const agentDir = join(agentsDir, entry);
          const checkpointPath = join(agentDir, 'checkpoint.json');
          if (existsSync(checkpointPath)) {
            try {
              const cp = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
              agents.push({
                agentId: cp.agentId || entry,
                name: cp.name || entry,
                status: cp.status || 'unknown',
                model: cp.model,
                provider: cp.provider,
                turnCount: cp.turnCount || 0,
                createdAt: cp.createdAt,
                lastCheckpointAt: cp.lastCheckpointAt,
              });
            } catch { /* skip corrupted */ }
          }
        }
      } catch { /* skip */ }

      return {
        success: true,
        agents: agents.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
        count: agents.length,
      };
    }
  },

  // ---- local_agent_terminate ----
  {
    name: 'local_agent_terminate',
    description: 'Terminate a local agent and delete its data.',
    input_schema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID to terminate.' },
      },
      required: ['agentId']
    },
    async handler(args) {
      const agentDir = getAgentDir(args.agentId);
      if (!existsSync(agentDir)) {
        return { success: false, error: `Agent not found: ${args.agentId}` };
      }

      // Stop any running async loop for this agent
      const prefix = args.agentId + '-task-';
      for (const [tid, task] of runningLoops) {
        if (tid.startsWith(prefix)) {
          runningLoops.delete(tid);
        }
      }
      // Remove from queue
      const qIdx = loopQueue.findIndex(t => t.agentId === args.agentId);
      if (qIdx >= 0) loopQueue.splice(qIdx, 1);

      try {
        rmSync(agentDir, { recursive: true, force: true });
        return { success: true, agentId: args.agentId, message: 'Agent terminated and data deleted.' };
      } catch (err) {
        return { success: false, error: `Failed to terminate: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  },
];
