/**
 * @claude-flow/providers
 *
 * Multi-LLM Provider System for Claude Flow V3
 *
 * Supports:
 * - Anthropic (Claude 3.5, 3 Opus, Sonnet, Haiku)
 * - OpenAI (GPT-4o, o1, GPT-4, GPT-3.5)
 * - Google (Gemini 2.0, 1.5 Pro, Flash)
 * - Cohere (Command R+, R, Light)
 * - Ollama (Local: Llama, Mistral, CodeLlama, Phi)
 * - DeepSeek (V4 Pro, V4 Flash via Anthropic-compatible endpoint)
 *
 * Features:
 * - Load balancing (round-robin, latency, cost-based)
 * - Automatic failover
 * - Request caching
 * - Cost optimization (85%+ savings with intelligent routing)
 * - Circuit breaker protection
 * - Health monitoring
 *
 * @module @claude-flow/providers
 */

// Export types
export * from './types.js';

// Export base provider
export { BaseProvider, consoleLogger } from './base-provider.js';
export type { BaseProviderOptions, ILogger } from './base-provider.js';

// Export providers
export { AnthropicProvider } from './anthropic-provider.js';
export { OpenAIProvider } from './openai-provider.js';
export { GoogleProvider } from './google-provider.js';
export { CohereProvider } from './cohere-provider.js';
export { OllamaProvider } from './ollama-provider.js';
export { RuVectorProvider } from './ruvector-provider.js';
export { DeepSeekProvider } from './deepseek-provider.js';
export { OpenAICompatProvider } from './openai-compat-provider.js';
export type { OpenAICompatConfig } from './openai-compat-provider.js';
export { QwenProvider } from './qwen-provider.js';
export { KimiProvider } from './kimi-provider.js';
export { ZhipuProvider } from './zhipu-provider.js';
export { DoubaoProvider } from './doubao-provider.js';

// Export provider manager
export { ProviderManager, createProviderManager } from './provider-manager.js';
