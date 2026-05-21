/**
 * Kimi Provider — Moonshot AI.
 *
 * OpenAI-compatible endpoint at api.moonshot.cn.
 * Models: kimi-k2-turbo-preview, kimi-k2.6
 *
 * @module @claude-flow/providers/kimi-provider
 */

import { BaseProviderOptions } from './base-provider.js';
import { OpenAICompatConfig, OpenAICompatProvider } from './openai-compat-provider.js';

const KIMI_CONFIG: OpenAICompatConfig = {
  name: 'kimi',
  baseURL: 'https://api.moonshot.cn/v1',
  defaultModel: 'kimi-k2-turbo-preview',
  models: {
    'kimi-k2-turbo-preview': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'Kimi K2 Turbo Preview — fast, cost-efficient model',
      promptCostPer1k: 0,
      completionCostPer1k: 0,
    },
    'kimi-k2.6': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'Kimi K2.6 — flagship model for complex reasoning',
      promptCostPer1k: 0,
      completionCostPer1k: 0,
    },
  },
  supportsToolCalling: true,
  supportsStreaming: true,
};

export class KimiProvider extends OpenAICompatProvider {
  constructor(options: BaseProviderOptions) {
    super(options, KIMI_CONFIG);
  }
}
