/**
 * Doubao Provider — Ark / Volcano Engine (ByteDance).
 *
 * OpenAI-compatible endpoint at ark.cn-beijing.volces.com.
 * Models: doubao-lite-32k, doubao-pro-32k
 *
 * @module @claude-flow/providers/doubao-provider
 */

import { BaseProviderOptions } from './base-provider.js';
import { OpenAICompatConfig, OpenAICompatProvider } from './openai-compat-provider.js';

const DOUBAO_CONFIG: OpenAICompatConfig = {
  name: 'doubao',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  defaultModel: 'doubao-lite-32k',
  models: {
    'doubao-lite-32k': {
      contextLength: 32768,
      maxOutputTokens: 4096,
      description: 'Doubao Lite 32K — fast, cost-efficient model for simple tasks',
      promptCostPer1k: 0.00011,
      completionCostPer1k: 0.00011,
    },
    'doubao-pro-32k': {
      contextLength: 32768,
      maxOutputTokens: 4096,
      description: 'Doubao Pro 32K — flagship model for complex reasoning',
      promptCostPer1k: 0.0008,
      completionCostPer1k: 0.002,
    },
  },
  supportsToolCalling: false,
  supportsStreaming: true,
};

export class DoubaoProvider extends OpenAICompatProvider {
  constructor(options: BaseProviderOptions) {
    super(options, DOUBAO_CONFIG);
  }
}
