/**
 * Zhipu Provider — BigModel (Zhipu AI / Tsinghua).
 *
 * OpenAI-compatible endpoint at open.bigmodel.cn.
 * Models: GLM-4.7-Flash, GLM-5, GLM-5.1
 *
 * @module @claude-flow/providers/zhipu-provider
 */

import { BaseProviderOptions } from './base-provider.js';
import { OpenAICompatConfig, OpenAICompatProvider } from './openai-compat-provider.js';

const ZHIPU_CONFIG: OpenAICompatConfig = {
  name: 'zhipu',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  defaultModel: 'GLM-4.7-Flash',
  models: {
    'GLM-4.7-Flash': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'GLM-4.7 Flash — fast, free model for high-throughput tasks',
      promptCostPer1k: 0,
      completionCostPer1k: 0,
    },
    'GLM-5': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'GLM-5 — balanced performance model',
      promptCostPer1k: 0.0007,
      completionCostPer1k: 0.0007,
    },
    'GLM-5.1': {
      contextLength: 131072,
      maxOutputTokens: 8192,
      description: 'GLM-5.1 — flagship model for complex reasoning',
      promptCostPer1k: 0.0014,
      completionCostPer1k: 0.0014,
    },
  },
  supportsToolCalling: true,
  supportsStreaming: true,
};

export class ZhipuProvider extends OpenAICompatProvider {
  constructor(options: BaseProviderOptions) {
    super(options, ZHIPU_CONFIG);
  }
}
