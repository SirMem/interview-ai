# ADR-0001: Multi-Channel AI Provider with Priority Scheduling

**Status:** Accepted  
**Date:** 2026-06-06  
**Driver:** Need to support custom API endpoints, multiple API keys, and intelligent failover across AI providers.

## Context

The original SolveWatch AI config stored provider settings flat in `.env`:

```env
OPENAI_API_KEY=sk-xxx
GROQ_API_KEY=gsk_xxx
PROVIDER_ORDER=openai,grok,gemini,claude
```

This had several limitations:
- No support for custom `baseUrl` — each provider's SDK endpoint was hardcoded
- Only one API key per provider — no key rotation
- Fallback was a simple ordered list with no circuit breaker
- Adding a new provider meant modifying code (`switch/case` in `ai.service.js`)
- Gemini protocol was supported but never actually used in interview scenarios

The user wanted the same flexibility as the ccx-main project's channel system: create arbitrary upstream configurations with custom base URLs, multiple keys, priority-based scheduling, and automatic circuit breaking.

## Decision

### 1. New config file: `config/channels.json`

All provider configuration moves from `.env` to a dedicated JSON array. `.env` retains only non-provider settings (STT, HUD, interview role, etc.).

```json
[
  {
    "name": "My Proxy",
    "serviceType": "openai-compatible",
    "baseUrl": "https://api.myproxy.com/v1",
    "apiKeys": ["sk-xxx", "sk-yyy"],
    "model": "gpt-4o-mini",
    "priority": 1,
    "status": "active"
  },
  {
    "name": "Anthropic Official",
    "serviceType": "anthropic",
    "baseUrl": "",
    "apiKeys": ["sk-ant-xxx"],
    "model": "claude-sonnet-4-5",
    "priority": 10,
    "status": "active"
  }
]
```

### 2. Two service types only

| Service type | SDK | Used for |
|---|---|---|
| `openai-compatible` | `openai` npm | OpenAI, Groq, Ollama, any OpenAI-compatible proxy |
| `anthropic` | `@anthropic-ai/sdk` | Claude direct or Anthropic-compatible proxy |

Gemini was removed because it was unused in interview flows and adds significant SDK surface area.

### 3. Priority-based scheduling with round-robin

- Channels are ordered by `priority` (ascending)
- Same priority → round-robin across channels at that level
- Only `active` channels participate in scheduling

### 4. Circuit breaker

- After N consecutive failures (configurable, default 3), a channel auto-transitions to `paused`
- Paused channels are skipped during scheduling
- Admin can manually resume via the settings page (set back to `active`)
- Optional: auto-recovery after a cooldown period

### 5. UI: Add Channel modal (ccx-main style)

A new modal dialog with the following fields:

| Field | Type | Required |
|---|---|---|
| Name | text | yes |
| Service Type | dropdown (`openai-compatible` / `anthropic`) | yes |
| Base URL | text (optional) | no (empty = SDK default) |
| API Keys | textarea (one per line) | yes |
| Model | text | yes |
| Priority | number | auto-default |

## Consequences

### Positive
- Users can use any OpenAI-compatible proxy without code changes
- Multi-key rotation reduces per-key rate-limit failures
- Circuit breaker prevents wasting time on dead endpoints
- Priority + round-robin gives fine-grained traffic control
- Config is human-readable and directly editable

### Negative
- Migration needed: existing `.env` provider keys must be imported into `channels.json`
- `ai.service.js` dispatch logic (`switch/case`) must be replaced with a generic SDK factory
- Gemini support is dropped (no active usage, can be re-added later)

## Alternatives considered

**Keep `.env` with baseUrl fields** — rejected because `.env` is a flat key-value format unsuitable for arrays of keys and structured objects. Parsing multi-line arrays from env vars is error-prone.

**Keep all four service types** — rejected because Groq uses the same SDK as OpenAI (just different baseUrl), and Gemini was unused. Two types cover all real usage.

**No circuit breaker, simple sequential fallback** — rejected because a permanently dead endpoint would block every request until timeout, making the interview assistant unusable.

