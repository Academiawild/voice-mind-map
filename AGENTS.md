# Agent Rules

## Product Scope

- Keep this project focused on the local web MVP.
- Do not add WeChat, Telegram, desktop app, or mobile app features in the first version.
- Do not expand scope during bug-fix tasks.

## Security

- Do not put API keys in the frontend.
- Do not rewrite `.env` secrets unless the user explicitly asks.

## Mindmap Safety

- All AI output must be validated with structured schemas before it reaches the UI.
- Treat `shared/mind-map/*` as the most sensitive logic in the repo.
- If the task is unrelated to mind map semantics, avoid changing `shared/mind-map/*`.

## Realtime ASR Safety

- Browser connects only to the local backend websocket route.
- Do not connect the browser directly to FunASR.
- Realtime PCM must not be routed into `ffmpeg`.
- Keep fallback HTTP transcription and realtime websocket transcription separate.

## Change Discipline

- Prefer small, targeted edits.
- If the task is startup/runtime related, fix `scripts/`, `start.command`, or server wiring first.
- If the task is UI related, prefer changing `src/` without touching backend logic.

## Verification

- After any change, run `npm run typecheck`.
- If behavior, schema, or service logic changed, also run `npm test`.

## Handoff

- Keep README and docs up to date when startup flow, architecture, or handoff assumptions change.
- Future AI agents should read:
  1. `AGENTS.md`
  2. `README.md`
  3. `docs/project-structure.md`
  4. `docs/ai-handoff.md`
