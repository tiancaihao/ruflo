/**
 * Qwen Provider — DashScope (Alibaba Cloud).
 *
 * OpenAI-compatible endpoint at dashscope.aliyuncs.com.
 * Models: qwen3.6-flash, qwen3.6-plus, qwen3.6-max-preview
 *
 * @module @claude-flow/providers/qwen-provider
 */

import { BaseProviderOptions } from './base-provider.js';
import { OpenAICompatConfig, OpenAICompatProvider } from './openai-compat-provider.js';

const QWEN_CONFIG: OpenAICompatConfig = {
  name: 'qwen',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  defaultModel: 'qwen3.6-flash',
  models: {
    'qwen3.6-flash': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'Qwen 3.6 Flash — fast, cost-efficient model for high-throughput tasks',
      promptCostPer1k: 0,
      completionCostPer1k: 0,
    },
    'qwen3.6-plus': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'Qwen 3.6 Plus — balanced performance and efficiency',
      promptCostPer1k: 0.00055,
      completionCostPer1k: 0.0022,
    },
    'qwen3.6-max-preview': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'Qwen 3.6 Max (Preview) — flagship model for complex reasoning',
      promptCostPer1k: 0.0011,
      completionCostPer1k: 0.0044,
    },
  },
  supportsToolCalling: true,
  supportsStreaming: true,
};

export class QwenProvider extends OpenAICompatProvider {
  constructor(options: BaseProviderOptions) {
    super(options, QWEN_CONFIG);
  }
}
