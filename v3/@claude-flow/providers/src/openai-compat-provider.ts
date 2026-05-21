/**
 * OpenAI-Compatible Provider base class.
 *
 * Generic base for providers that speak the OpenAI chat-completions wire
 * format. Subclasses set their own base URL, model list, pricing, and
 * capabilities via the constructor config.
 *
 * @module @claude-flow/providers/openai-compat-provider
 */

import { BaseProvider, BaseProviderOptions } from './base-provider.js';
import {
  LLMProvider,
  LLMModel,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelInfo,
  ProviderCapabilities,
  HealthCheckResult,
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
  LLMProviderError,
} from './types.js';

export interface OpenAICompatConfig {
  /** Provider identifier (e.g. 'qwen', 'kimi') */
  name: LLMProvider;
  /** Base URL for the OpenAI-compatible endpoint */
  baseURL: string;
  /** Default model to use when none specified */
  defaultModel: LLMModel;
  /** Supported models with context/output limits and pricing */
  models: Record<string, {
    contextLength: number;
    maxOutputTokens: number;
    description: string;
    promptCostPer1k: number;
    completionCostPer1k: number;
  }>;
  /** Feature flags */
  supportsToolCalling?: boolean;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
  /** Optional extra headers (e.g. some providers want custom headers) */
  extraHeaders?: Record<string, string>;
}

interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAICompatProvider extends BaseProvider {
  readonly name: LLMProvider;
  readonly capabilities: ProviderCapabilities;

  private baseURL: string;
  private compatConfig: OpenAICompatConfig;
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions, compatConfig: OpenAICompatConfig) {
    super(options);
    this.compatConfig = compatConfig;
    this.name = compatConfig.name;
    this.baseURL = compatConfig.baseURL;

    const modelIds = Object.keys(compatConfig.models);
    const maxCtx: Record<string, number> = {};
    const maxOut: Record<string, number> = {};
    const pricing: ProviderCapabilities['pricing'] = {};

    for (const [id, cfg] of Object.entries(compatConfig.models)) {
      maxCtx[id] = cfg.contextLength;
      maxOut[id] = cfg.maxOutputTokens;
      pricing[id] = {
        promptCostPer1k: cfg.promptCostPer1k,
        completionCostPer1k: cfg.completionCostPer1k,
        currency: 'USD',
      };
    }

    this.capabilities = {
      supportedModels: modelIds,
      maxContextLength: maxCtx,
      maxOutputTokens: maxOut,
      supportsStreaming: compatConfig.supportsStreaming ?? true,
      supportsToolCalling: compatConfig.supportsToolCalling ?? false,
      supportsSystemMessages: true,
      supportsVision: compatConfig.supportsVision ?? false,
      supportsAudio: false,
      supportsFineTuning: false,
      supportsEmbeddings: false,
      supportsBatching: false,
      pricing,
    };
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError(
        `${this.compatConfig.name} API key is required`,
        this.name,
      );
    }

    this.baseURL = this.config.apiUrl || this.compatConfig.baseURL;
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      ...(this.compatConfig.extraHeaders || {}),
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const req = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = (await response.json()) as OpenAIResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const req = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
              const model = request.model || this.config.model;
              const pricing = this.capabilities.pricing[model];
              const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
              const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

              yield {
                type: 'done',
                usage: { promptTokens, completionTokens: 100, totalTokens: promptTokens + 100 },
                cost: {
                  promptCost: (promptTokens / 1000) * promptCostPer1k,
                  completionCost: (100 / 1000) * completionCostPer1k,
                  totalCost: (promptTokens / 1000) * promptCostPer1k + (100 / 1000) * completionCostPer1k,
                  currency: 'USD',
                },
              };
              continue;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.content) {
                yield { type: 'content', delta: { content: delta.content } };
              }
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: 'tool_call',
                    delta: { toolCall: { id: tc.id, type: 'function', function: tc.function } },
                  };
                }
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<LLMModel[]> {
    return this.capabilities.supportedModels;
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    const cfg = this.compatConfig.models[model];
    return {
      model,
      name: model,
      description: cfg?.description || `${this.compatConfig.name} model`,
      contextLength: cfg?.contextLength || 131072,
      maxOutputTokens: cfg?.maxOutputTokens || 8192,
      supportedFeatures: ['chat', 'completion'],
      pricing: cfg ? {
        promptCostPer1k: cfg.promptCostPer1k,
        completionCostPer1k: cfg.completionCostPer1k,
        currency: 'USD',
      } : undefined,
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        headers: this.headers,
      });
      return {
        healthy: response.ok,
        timestamp: new Date(),
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  private buildRequest(request: LLMRequest, stream = false): OpenAIRequest {
    const req: OpenAIRequest = {
      model: request.model || this.config.model || this.compatConfig.defaultModel,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
      })),
      stream,
    };

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      req.temperature = request.temperature ?? this.config.temperature;
    }
    if (request.maxTokens || this.config.maxTokens) {
      req.max_tokens = request.maxTokens || this.config.maxTokens;
    }
    if (request.topP !== undefined || this.config.topP !== undefined) {
      req.top_p = request.topP ?? this.config.topP;
    }
    if (request.frequencyPenalty !== undefined || this.config.frequencyPenalty !== undefined) {
      req.frequency_penalty = request.frequencyPenalty ?? this.config.frequencyPenalty;
    }
    if (request.presencePenalty !== undefined || this.config.presencePenalty !== undefined) {
      req.presence_penalty = request.presencePenalty ?? this.config.presencePenalty;
    }
    if (request.stopSequences || this.config.stopSequences) {
      req.stop = request.stopSequences || this.config.stopSequences;
    }
    if (request.tools) {
      req.tools = request.tools;
      req.tool_choice = request.toolChoice;
    }

    return req;
  }

  private transformResponse(data: OpenAIResponse, request: LLMRequest): LLMResponse {
    const choice = data.choices[0];
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];
    const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
    const completionCostPer1k = pricing?.completionCostPer1k ?? 0;
    const promptCost = (data.usage.prompt_tokens / 1000) * promptCostPer1k;
    const completionCost = (data.usage.completion_tokens / 1000) * completionCostPer1k;

    return {
      id: data.id,
      model: model as LLMModel,
      provider: this.name,
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: choice.finish_reason,
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorData: { error?: { message?: string } };
    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }

    const message = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, this.name, errorData);
      case 429:
        throw new RateLimitError(message, this.name, undefined, errorData);
      case 404:
        throw new ModelNotFoundError(this.config.model, this.name, errorData);
      default:
        throw new LLMProviderError(
          message, `${this.name.toUpperCase()}_${response.status}`,
          this.name, response.status, response.status >= 500, errorData,
        );
    }
  }
}
