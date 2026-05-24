## ADDED Requirements

### Requirement: Ruflo installation detection
The system SHALL detect whether ruflo is already installed via npx cache before applying patches.

#### Scenario: Ruflo is already installed
- **WHEN** `~/.npm/_npx/` contains a hash directory with `node_modules/@claude-flow/cli/bin/mcp-server.js`
- **THEN** the system uses the existing npx cache path and proceeds to patching

#### Scenario: Ruflo is not installed
- **WHEN** no npx cache directory contains ruflo's `bin/mcp-server.js`
- **THEN** the system runs `npx -y ruflo@latest init --force` to install ruflo
- **AND** retrieves the newly created npx cache path

#### Scenario: Global npm ruflo takes precedence
- **WHEN** ruflo is installed globally via `npm install -g ruflo`
- **AND** npx cache also exists
- **THEN** the system prefers the npx cache path (consistent with how Claude Code MCP spawns)

### Requirement: Idempotent multi-layer patching
The system SHALL apply L1, L2, L3 patches to `agent-execute-core.js` in the npx cache, with each patch checking for prior application.

#### Scenario: All patches already applied
- **WHEN** all three patch markers are detected in the target file
- **THEN** the system skips patching and reports "already patched"
- **AND** continues to provider configuration

#### Scenario: Partial patches applied
- **WHEN** some but not all patch markers are detected
- **THEN** the system applies only the missing patches
- **AND** reports which patches were applied and which were skipped

#### Scenario: No patches applied (fresh file)
- **WHEN** no patch markers are detected
- **THEN** the system applies all three patches in order
- **AND** reports total patches applied

#### Scenario: Patch target file structure changed
- **WHEN** the target file does not contain expected function signatures
- **THEN** the system prints a warning with the actual function signatures found
- **AND** exits with non-zero code

### Requirement: MCP configuration update
After patching, the system SHALL update the existing MCP server configuration to lock it to the patched files.

#### Scenario: Project .mcp.json has ruflo key
- **WHEN** project `.mcp.json` contains `mcpServers.ruflo`
- **THEN** the system updates the `command` to `node`
- **AND** updates `args` to `[<npx_cache_path>/bin/mcp-server.js]`
- **AND** adds the configured API key to the `env` field
- **AND** preserves all existing `env` fields

#### Scenario: Project .mcp.json has claude-flow key (legacy)
- **WHEN** project `.mcp.json` contains `mcpServers.claude-flow` but not `mcpServers.ruflo`
- **THEN** the system updates `mcpServers.claude-flow` in the same manner
- **AND** renames the key to `ruflo`

#### Scenario: No MCP config exists
- **WHEN** neither project `.mcp.json` nor `~/.claude.json` contains a ruflo MCP server
- **THEN** the system creates project `.mcp.json` with the `ruflo` MCP server
- **AND** uses `node` command with patched path

#### Scenario: ~/.claude.json has ruflo key (user-level config)
- **WHEN** `~/.claude.json` contains `mcpServers.ruflo`
- **THEN** the system updates it in-place
- **AND** warns the user this is a global config affecting all projects

### Requirement: Interactive provider selection
In interactive mode (TTY detected), the system SHALL present an arrow-key navigable provider menu after patching.

#### Scenario: Provider menu displayed
- **WHEN** stdin is a TTY
- **THEN** the system displays a menu of available providers with arrow-key navigation
- **AND** each option shows provider name and required environment variable

#### Scenario: Non-interactive fallback
- **WHEN** stdin is not a TTY (pipe, CI)
- **THEN** the system skips the interactive menu
- **AND** prints the provider configuration guide for manual setup
- **AND** exits with code 0

### Requirement: API key input with hidden echo
After provider selection, the system SHALL prompt for the API key with input hidden from screen.

#### Scenario: Key input accepted
- **WHEN** user enters a non-empty API key
- **THEN** the system proceeds to connectivity test

#### Scenario: Empty key re-prompted
- **WHEN** user enters an empty API key
- **THEN** the system displays "API key cannot be empty"
- **AND** re-prompts for input (max 3 times)

### Requirement: Provider connectivity test
The system SHALL verify the API key by sending a test request to the selected provider's API endpoint.

#### Scenario: Test succeeds (HTTP 2xx)
- **WHEN** the test request returns HTTP 2xx
- **THEN** the system displays "Connection successful"
- **AND** stores the API key for MCP configuration

#### Scenario: Test succeeds (HTTP 401 - valid key, insufficient permissions)
- **WHEN** the test request returns HTTP 401
- **THEN** the system displays "API key is valid but may lack required permissions"
- **AND** stores the API key for MCP configuration

#### Scenario: Test fails (HTTP 403 or other error)
- **WHEN** the test request returns HTTP 403 or other error
- **THEN** the system displays the error code and message
- **AND** offers retry, skip, or exit options

#### Scenario: Network timeout
- **WHEN** the test request times out (10s)
- **THEN** the system displays "Network error: unable to reach <provider> API"
- **AND** offers retry or skip options

### Requirement: Retry and skip mechanism
The system SHALL allow up to 3 attempts for API key configuration, with skip option at each failure.

#### Scenario: User retries after failure
- **WHEN** connectivity test fails and user has fewer than 3 total attempts
- **THEN** the system re-prompts for API key
- **AND** re-runs connectivity test

#### Scenario: User skips after failure
- **WHEN** user selects "Skip" at any attempt
- **THEN** the system prints manual configuration instructions
- **AND** exits with code 0

#### Scenario: Max attempts reached
- **WHEN** all 3 attempts fail
- **THEN** the system prints the complete configuration guide
- **AND** exits with code 0

### Requirement: MCP command locking
The system SHALL replace `npx` with `node` + absolute path in the MCP server command to prevent patch loss on npx cache refresh.

#### Scenario: Original command uses npx
- **WHEN** the existing MCP command is `npx -y ruflo@latest mcp start`
- **THEN** the system replaces it with `node <absolute_npx_cache>/bin/mcp-server.js`

#### Scenario: Command already locked to node
- **WHEN** the existing MCP command already uses `node` with a patched path
- **THEN** the system updates the path to the current npx cache if different
- **AND** reports "MCP command updated" or "MCP command already up to date"

### Requirement: Provider test endpoints
The system SHALL use the correct API endpoint for each provider's connectivity test.

#### Scenario: DeepSeek test
- **WHEN** provider is DeepSeek
- **THEN** test endpoint is `POST https://api.deepseek.com/v1/models` with `Authorization: Bearer <key>`

#### Scenario: Qwen (DashScope) test
- **WHEN** provider is Qwen
- **THEN** test endpoint is `GET https://dashscope.aliyuncs.com/compatible-mode/v1/models` with `Authorization: Bearer <key>`

#### Scenario: Kimi (Moonshot) test
- **WHEN** provider is Kimi
- **THEN** test endpoint is `GET https://api.moonshot.cn/v1/models` with `Authorization: Bearer <key>`

#### Scenario: Zhipu (BigModel) test
- **WHEN** provider is Zhipu
- **THEN** test endpoint is `GET https://open.bigmodel.cn/api/paas/v4/models` with `Authorization: Bearer <key>`

#### Scenario: Doubao (Ark) test
- **WHEN** provider is Doubao
- **THEN** test endpoint is `GET https://ark.cn-beijing.volces.com/api/v3/models` with `Authorization: Bearer <key>`
