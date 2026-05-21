/**
 * V3 DeepSeek Provider
 *
 * Uses DeepSeek's Anthropic-compatible API endpoint.
 * Supports deepseek-v4-pro (flagship) and deepseek-v4-flash (fast).
 *
 * Wire format: Anthropic Messages API (identical to AnthropicProvider).
 * Endpoint: https://api.deepseek.com/anthropic/v1/messages
 * Auth: x-api-key (same as Anthropic)
 *
 * @module @claude-flow/providers/deepseek-provider
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
  LLMProviderError,
} from './types.js';

interface AnthropicRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; source?: unknown }>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class DeepSeekProvider extends BaseProvider {
  readonly name: LLMProvider = 'deepseek';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
    ],
    maxContextLength: {
      'deepseek-v4-pro': 1000000,
      'deepseek-v4-flash': 1000000,
    },
    maxOutputTokens: {
      'deepseek-v4-pro': 384000,
      'deepseek-v4-flash': 384000,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: false,
    rateLimit: {
      requestsPerMinute: 500,
      tokensPerMinute: 500000,
      concurrentRequests: 50,
    },
    pricing: {
      'deepseek-v4-pro': {
        promptCostPer1k: 0.00040,
        completionCostPer1k: 0.00110,
        currency: 'USD',
      },
      'deepseek-v4-flash': {
        promptCostPer1k: 0.00014,
        completionCostPer1k: 0.00028,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.deepseek.com/anthropic';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('DeepSeek API key is required', 'deepseek');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.deepseek.com/anthropic';
    this.headers = {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const deepseekRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 120000);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(deepseekRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as AnthropicResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const deepseekRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 120000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(deepseekRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalOutputTokens = 0;
      let inputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.text) {
                yield {
                  type: 'content',
                  delta: { content: event.delta.text },
                };
              } else if (event.type === 'message_delta' && event.usage) {
                totalOutputTokens = event.usage.output_tokens;
              } else if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens;
              } else if (event.type === 'message_stop') {
                const model = request.model || this.config.model;
                const pricing = this.capabilities.pricing[model];

                const promptCost = pricing ? (inputTokens / 1000) * pricing.promptCostPer1k : 0;
                const completionCost = pricing ? (totalOutputTokens / 1000) * pricing.completionCostPer1k : 0;

                yield {
                  type: 'done',
                  usage: {
                    promptTokens: inputTokens,
                    completionTokens: totalOutputTokens,
                    totalTokens: inputTokens + totalOutputTokens,
                  },
                  cost: {
                    promptCost,
                    completionCost,
                    totalCost: promptCost + completionCost,
                    currency: 'USD',
                  },
                };
              }
            } catch {
              // Ignore parse errors
            }
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
    const descriptions: Record<string, string> = {
      'deepseek-v4-pro': 'DeepSeek V4 Pro — flagship model for complex reasoning and agent tasks',
      'deepseek-v4-flash': 'DeepSeek V4 Flash — fast, cost-efficient model for high-throughput tasks',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'DeepSeek language model',
      contextLength: this.capabilities.maxContextLength[model] || 1000000,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 384000,
      supportedFeatures: ['chat', 'completion', 'tool_calling'],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
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

  private buildRequest(request: LLMRequest, stream = false): AnthropicRequest {
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    const messages = otherMessages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));

    const anthropicRequest: AnthropicRequest = {
      model: request.model || this.config.model,
      messages,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      stream,
    };

    if (systemMessage) {
      anthropicRequest.system = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content);
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    } else if (this.config.temperature !== undefined) {
      anthropicRequest.temperature = this.config.temperature;
    }

    if (request.topP !== undefined || this.config.topP !== undefined) {
      anthropicRequest.top_p = request.topP ?? this.config.topP;
    }

    // Note: top_k is not set — DeepSeek ignores it

    if (request.stopSequences || this.config.stopSequences) {
      anthropicRequest.stop_sequences = request.stopSequences || this.config.stopSequences;
    }

    if (request.tools) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
    }

    return anthropicRequest;
  }

  private transformResponse(data: AnthropicResponse, request: LLMRequest): LLMResponse {
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];

    const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
    const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

    const promptCost = (data.usage.input_tokens / 1000) * promptCostPer1k;
    const completionCost = (data.usage.output_tokens / 1000) * completionCostPer1k;

    const textContent = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    const toolCalls = data.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: `tool_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: c.name || '',
          arguments: JSON.stringify(c.input || {}),
        },
      }));

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'deepseek',
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
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
        throw new AuthenticationError(message, 'deepseek', errorData);
      case 429:
        throw new RateLimitError(message, 'deepseek', undefined, errorData);
      default:
        throw new LLMProviderError(
          message,
          `DEEPSEEK_${response.status}`,
          'deepseek',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
