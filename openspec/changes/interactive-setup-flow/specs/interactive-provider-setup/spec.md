## ADDED Requirements

### Requirement: Interactive provider selection
After all patches are applied, the system SHALL present an interactive menu allowing the user to choose a LLM provider.

#### Scenario: Provider menu displayed
- **WHEN** setup.sh completes all patch steps (L1, L2, L3)
- **AND** stdin is a TTY (interactive terminal)
- **THEN** the system displays a numbered menu of available providers: DeepSeek, Qwen (DashScope), Kimi (Moonshot), Zhipu (BigModel), Doubao (Ark)
- **AND** each option shows the provider name and required environment variable name

#### Scenario: Non-interactive fallback
- **WHEN** setup.sh runs in a non-TTY environment (pipe, CI)
- **THEN** the system skips the interactive menu and prints the provider configuration guide as before
- **AND** exits with code 0

### Requirement: API key input
The system SHALL prompt the user to enter an API key after provider selection, with input hidden from the screen.

#### Scenario: Key input with hidden echo
- **WHEN** user selects a provider from the menu
- **THEN** the system prompts "Enter your <ProviderName> API key:"
- **AND** typed characters are NOT displayed on screen (`read -s`)

#### Scenario: Empty key rejected
- **WHEN** user enters an empty API key
- **THEN** the system displays "API key cannot be empty" and re-prompts

### Requirement: Connectivity test
The system SHALL verify API key validity by sending a lightweight test request to the selected provider's API endpoint.

#### Scenario: Test request succeeds
- **WHEN** user enters a valid API key for the selected provider
- **THEN** the system sends a GET/POST request to the provider's models/list endpoint
- **AND** if the response is HTTP 2xx or 401 (valid key but insufficient permissions), displays "Connection successful! API key is valid."
- **AND** continues to setup completion

#### Scenario: Test request fails with 401
- **WHEN** user enters an invalid API key
- **AND** the test request returns HTTP 401
- **THEN** the system displays "API key rejected. Please check your key and try again."
- **AND** offers retry

#### Scenario: Test request fails with network error
- **WHEN** the test request times out or fails with a connection error
- **THEN** the system displays "Network error: unable to reach <provider> API. Check your internet connection."
- **AND** offers retry or skip

### Requirement: Retry and skip
The system SHALL allow retry (up to 3 attempts) or skip of the API key configuration step.

#### Scenario: Retry after failure
- **WHEN** connectivity test fails
- **AND** user has made fewer than 3 attempts
- **THEN** the system offers: "1) Try again  2) Skip and configure later  3) Exit"
- **AND** selecting "Try again" returns to the API key input prompt

#### Scenario: Skip configuration
- **WHEN** user selects "Skip and configure later"
- **THEN** the system prints the manual configuration instructions
- **AND** exits with code 0

#### Scenario: Max retries reached
- **WHEN** connectivity test fails 3 times
- **THEN** the system prints "3 attempts failed. You can configure your API key manually:"
- **AND** prints the provider-specific environment variable and setup instructions
- **AND** exits with code 0

### Requirement: Provider test endpoints
The system SHALL use the correct API endpoint for each provider's connectivity test.

#### Scenario: DeepSeek connectivity test
- **WHEN** provider is DeepSeek
- **THEN** the system sends `POST https://api.deepseek.com/v1/models` with `Authorization: Bearer $APIKEY`

#### Scenario: Qwen (DashScope) connectivity test
- **WHEN** provider is Qwen
- **THEN** the system sends `POST https://dashscope.aliyuncs.com/compatible-mode/v1/models` with `Authorization: Bearer $APIKEY`

#### Scenario: Kimi (Moonshot) connectivity test
- **WHEN** provider is Kimi
- **THEN** the system sends `POST https://api.moonshot.cn/v1/models` with `Authorization: Bearer $APIKEY`

#### Scenario: Zhipu (BigModel) connectivity test
- **WHEN** provider is Zhipu
- **THEN** the system sends `POST https://open.bigmodel.cn/api/paas/v4/models` with `Authorization: Bearer $APIKEY`

#### Scenario: Doubao (Ark) connectivity test
- **WHEN** provider is Doubao
- **THEN** the system sends `POST https://ark.cn-beijing.volces.com/api/v3/models` with `Authorization: Bearer $APIKEY`
