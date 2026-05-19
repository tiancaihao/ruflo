## ADDED Requirements

### Requirement: DeepSeekProvider implements ILLMProvider interface
The system SHALL provide a `DeepSeekProvider` class that implements the `ILLMProvider` interface, supporting Anthropic-compatible wire format to communicate with DeepSeek's API.

#### Scenario: Provider initialization with API key
- **WHEN** DeepSeekProvider is initialized with a valid `LLMProviderConfig` containing `provider: 'deepseek'` and `apiKey`
- **THEN** the provider sets `baseUrl` to `https://api.deepseek.com/anthropic` and configures headers with `x-api-key`

#### Scenario: Provider initialization without API key
- **WHEN** DeepSeekProvider is initialized without an `apiKey`
- **THEN** the provider throws `AuthenticationError` with provider name `'deepseek'`

### Requirement: Supported models
The DeepSeekProvider SHALL support `deepseek-v4-pro` and `deepseek-v4-flash` as valid model names.

#### Scenario: Validate supported model
- **WHEN** `validateModel('deepseek-v4-pro')` is called
- **THEN** the method returns `true`

#### Scenario: Reject unsupported model
- **WHEN** `validateModel('claude-3-opus-20240229')` is called
- **THEN** the method returns `false`

### Requirement: Model capabilities
The DeepSeekProvider SHALL report accurate capability flags for DeepSeek models.

#### Scenario: Capability flags
- **WHEN** `capabilities` property is accessed
- **THEN** `supportsStreaming` is `true`, `supportsToolCalling` is `true`, `supportsSystemMessages` is `true`, `supportsVision` is `false`, `supportsAudio` is `false`

### Requirement: Context window and output limits
The DeepSeekProvider SHALL report 1,000,000 token context window and 384,000 token max output for both supported models.

#### Scenario: Max context length
- **WHEN** `capabilities.maxContextLength` is queried for `deepseek-v4-pro` or `deepseek-v4-flash`
- **THEN** the value is `1000000`

#### Scenario: Max output tokens
- **WHEN** `capabilities.maxOutputTokens` is queried for `deepseek-v4-pro` or `deepseek-v4-flash`
- **THEN** the value is `384000`

### Requirement: Anthropic-compatible request format
The DeepSeekProvider SHALL build requests in Anthropic Messages API format (`POST /v1/messages`) with `x-api-key` authentication.

#### Scenario: Request construction
- **WHEN** `doComplete()` receives an `LLMRequest` with user message "Hello"
- **THEN** the HTTP request is sent to `https://api.deepseek.com/anthropic/v1/messages` with headers `x-api-key` and `content-type: application/json`

#### Scenario: System message extraction
- **WHEN** `LLMRequest` contains a message with `role: 'system'`
- **THEN** the system message is extracted into the `system` field of the Anthropic request, separate from the `messages` array

### Requirement: SSE streaming support
The DeepSeekProvider SHALL support Server-Sent Events streaming in the same format as AnthropicProvider.

#### Scenario: Stream content delta
- **WHEN** a streaming response includes `content_block_delta` events
- **THEN** the provider yields `LLMStreamEvent` with `type: 'content'` and `delta.content` containing the text

#### Scenario: Stream completion
- **WHEN** a streaming response includes `message_stop` event
- **THEN** the provider yields `LLMStreamEvent` with `type: 'done'`, including token usage and cost

### Requirement: Tool calling support
The DeepSeekProvider SHALL support function/tool calling via the Anthropic `tools` and `tool_use` content blocks.

#### Scenario: Tool call request
- **WHEN** `LLMRequest` includes a `tools` array with function definitions
- **THEN** the Anthropic request includes `tools` formatted as `{name, description, input_schema}`

#### Scenario: Tool call response parsing
- **WHEN** the API response contains `content` with `type: 'tool_use'` blocks
- **THEN** the provider parses them into `LLMToolCall` objects with `id`, `type: 'function'`, and `function: {name, arguments}`

### Requirement: Error handling
The DeepSeekProvider SHALL map DeepSeek API errors to the standard error types.

#### Scenario: Authentication failure (401)
- **WHEN** API returns HTTP 401
- **THEN** the provider throws `AuthenticationError` with provider `'deepseek'`

#### Scenario: Rate limit (429)
- **WHEN** API returns HTTP 429
- **THEN** the provider throws `RateLimitError` with provider `'deepseek'`

#### Scenario: Server error (5xx)
- **WHEN** API returns HTTP 500 or higher
- **THEN** the provider throws `LLMProviderError` with `retryable: true`

### Requirement: Health check
The DeepSeekProvider SHALL perform health checks by sending a minimal request to the DeepSeek API.

#### Scenario: Healthy API
- **WHEN** health check minimal request returns HTTP 200
- **THEN** `healthCheck()` returns `{healthy: true}`

#### Scenario: Unhealthy API
- **WHEN** health check fails with network error or non-200 status
- **THEN** `healthCheck()` returns `{healthy: false}` with error message
