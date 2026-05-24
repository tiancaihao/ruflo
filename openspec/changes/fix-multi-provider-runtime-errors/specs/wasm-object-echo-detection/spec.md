## ADDED Requirements

### Requirement: Detect WASM echo stub in object format

The WASM agent echo detection SHALL recognize echo stubs when `wasmResult` is an object with a `response` field containing the echo text, in addition to the existing string format.

#### Scenario: WASM returns object with response field

- **WHEN** `wasmResult` is `{response: "echo: hello world"}`
- **AND** the input was `"hello world"`
- **THEN** `isEchoStub` evaluates to `true`
- **AND** the prompt is routed through the LLM fallback

#### Scenario: WASM returns plain string

- **WHEN** `wasmResult` is the string `"echo: hello world"`
- **AND** the input was `"hello world"`
- **THEN** `isEchoStub` evaluates to `true`

#### Scenario: WASM returns non-echo response

- **WHEN** `wasmResult` is `{response: "some real LLM output"}`
- **AND** it does not start with `"echo: "`
- **THEN** `isEchoStub` evaluates to `false`
- **AND** the response is returned as-is

### Requirement: Extract raw text from object response

The echo detection SHALL extract text using a fallback chain: `wasmResult.response` → `wasmResult.text` → empty string, before comparing against the echo pattern.

#### Scenario: Unknown object format

- **WHEN** `wasmResult` is `{data: "echo: test"}`
- **THEN** `rawResponse` is empty string
- **AND** `isEchoStub` is `false`
