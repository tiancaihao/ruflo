## ADDED Requirements

### Requirement: Discover all nested @claude-flow/cli copies

The setup script SHALL find all copies of `agent-execute-core.js` under the global npm installation tree, including nested `node_modules/@claude-flow/cli/node_modules/@claude-flow/cli/` directories.

#### Scenario: Single global install

- **WHEN** `@claude-flow/cli` is installed once at the global level
- **THEN** one target file is found and patched

#### Scenario: Nested dependency exists

- **WHEN** `@claude-flow/cli` has a self-referencing nested `node_modules/@claude-flow/cli/` directory
- **THEN** both the main copy and the nested copy are found and patched

#### Scenario: No copies found

- **WHEN** no `agent-execute-core.js` exists under any npm global path
- **THEN** the script exits with error message suggesting `npm install -g ruflo@latest`

### Requirement: Patch all discovered copies

The setup script SHALL apply the identical L1 multi-provider patch to every discovered copy of `agent-execute-core.js`.

#### Scenario: Multiple copies with one missing key function

- **WHEN** the main copy has been patched but a nested copy is pristine
- **THEN** all copies pass verification (contain `OPENAI_COMPAT_PROVIDERS`)

### Requirement: Exclude npx cache from patching

The setup script SHALL NOT patch files under `~/.npm/_npx/`; instead it SHALL delete corrupted npx caches (existing Step 3 behavior).

#### Scenario: Stale npx cache present

- **WHEN** an npx cache directory contains patched `agent-execute-core.js`
- **THEN** the entire cache directory is removed (not patched again)
