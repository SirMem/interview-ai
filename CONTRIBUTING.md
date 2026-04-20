# Contributing to SolveWatch AI

Thanks for your interest in contributing. Here's everything you need to get started.

---

## Getting started

```bash
git clone https://github.com/your-org/solveWatchAi.git
cd solveWatchAi
cp config/api-keys.json.example config/api-keys.json
# fill in at least one API key
./start.sh --setup   # installs all deps and starts everything
```

The settings UI is at `http://localhost:4000/settings`.

---

## Project structure at a glance

| Path | What it is |
|------|-----------|
| `src/` | Node.js backend (Express + Socket.IO) |
| `electron/` | Electron HUD overlay |
| `transcriber/` | Python STT service (Whisper + VAD) |
| `prompts/` | AI prompt templates (hot-reloaded) |
| `config/api-keys.json` | Runtime config — **never commit this** |
| `start.sh` | The only way to start all services together |

Full architecture is documented in [CLAUDE.md](CLAUDE.md).

---

## Development workflow

1. **Fork** the repo and create a branch: `git checkout -b feat/my-thing`
2. **Start** with `./start.sh` — don't start services individually
3. **Make changes** — the Node backend and AI prompts hot-reload without restart
4. **Test** both the screenshot flow and the always-on listen flow (`Cmd+Shift+X`)
5. **Open a PR** against `main` using the pull request template

---

## Code conventions

- **ESM only** — `import/export` everywhere, never `require()`
- **No `console.log`** in production paths — use `src/utils/logger.js`
- **Async/await** throughout; wrap Socket.IO handlers in `try/catch`
- **Ollama calls** must be fire-and-forget (never `await` them in answer paths)
- **No new state** outside `InterviewTranscriptBuffer` for session memory
- File names: `kebab-case.js` | Classes: `PascalCase` | Events: `snake_case`

---

## Key rules before submitting

- Do **not** commit `config/api-keys.json` — it's in `.gitignore` for a reason
- Do **not** add synchronous Ollama calls — they block answer streaming
- Do **not** use `require()` anywhere in `src/` or `electron/`
- If you change `electron/main.js` IPC events, update `electron/preload.js` too
- If you change AI provider logic, read `src/services/ai.service.js` first

---

## Submitting issues

Use the issue templates:
- **Bug report** — include logs (`logs/app.jsonl` or `logs/transcriber.log`) and your environment
- **Feature request** — describe the problem, not just the solution

**Security issues** — do not open a public issue. See [SECURITY.md](.github/SECURITY.md).

---

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
