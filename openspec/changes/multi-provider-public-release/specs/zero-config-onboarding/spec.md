## ADDED Requirements

### Requirement: One-command setup script

The system SHALL provide a `scripts/setup.sh` script that, when run from the project root, downloads the latest `ruflo` CLI via npx and patches the multi-provider routing into the compiled code. The script MUST exit with a clear success or error message.

#### Scenario: First-time setup
- **WHEN** a new user clones the repo and runs `./scripts/setup.sh`
- **THEN** the script downloads `ruflo@latest` to the npx cache, patches `agent-execute-core.js` with multi-provider support, and prints "Setup complete. Set your API key and restart Claude Code."

#### Scenario: Re-run after npm update
- **WHEN** npx has cached a newer ruflo version and the user re-runs `./scripts/setup.sh`
- **THEN** the script patches the new cache directory and reports success

### Requirement: Project-level MCP configuration

The project SHALL include a `.mcp.json` file that configures the `claude-flow` MCP server using `npx -y ruflo@latest mcp start`. This enables Claude Code to auto-detect and offer to enable the MCP server when the project is opened.

#### Scenario: Project opened in Claude Code
- **WHEN** a user opens the cloned project directory in Claude Code
- **THEN** Claude Code detects `.mcp.json` and prompts to enable the `claude-flow` MCP server

#### Scenario: MCP server starts successfully
- **WHEN** Claude Code starts the MCP server via the `.mcp.json` configuration
- **THEN** the server registers its tools (swarm_init, agent_spawn, memory_search, etc.) and is ready for use

### Requirement: API key configuration guide

The project SHALL include documentation (in README or docs/) listing each supported provider, how to obtain an API key, the environment variable name, and how to add it to `.claude/settings.json`.

#### Scenario: User wants to add Qwen support
- **WHEN** a user reads the provider configuration guide
- **THEN** they find: (1) where to get a DashScope API key, (2) that the env var is `DASHSCOPE_API_KEY`, (3) how to add it to `.claude/settings.json` or export it

### Requirement: .gitignore for secrets

The project's `.gitignore` SHALL exclude `.env` files and SHALL ensure API keys in `.claude/settings.json` are documented as needing replacement before commit.

#### Scenario: User accidentally commits API key
- **WHEN** `.env` is in `.gitignore`
- **THEN** git refuses to track the file, preventing accidental secret exposure
