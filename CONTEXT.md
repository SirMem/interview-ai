# SolveWatch AI — Domain Context

## Glossary

### Channel
A named AI provider configuration containing base URL(s), API key(s), service type, model name, and scheduling state. Represented as an entry in `config/channels.json`.

### Channel configuration store
`config/channels.json` — single JSON file replacing the flat `.env` keys for provider settings. Mirrors the ccx-main `config.json` structure.

### Channel status
One of `active` (normal, available for scheduling), `paused` (circuit-breaker triggered after repeated failures, skipped during scheduling), or `disabled` (manually turned off).

### Priority
An integer per channel. Lower number = higher scheduling priority. Channels with the same priority are called in round-robin fashion.

### Circuit breaker
When a channel fails N consecutive times, its status transitions to `paused` automatically. A paused channel can be manually resumed or auto-recovered after a cooldown period.

### Service type
The wire protocol used to talk to the upstream API. Two values:
- `openai-compatible` — uses the `openai` npm SDK (`chat.completions.create`). Covers OpenAI, Groq, Ollama, and any third-party proxy that exposes an OpenAI-compatible API.
- `anthropic` — uses the `@anthropic-ai/sdk` npm SDK (`messages.create`).

