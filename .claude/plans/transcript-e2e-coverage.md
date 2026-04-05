# Plan: Add transcript monitoring E2E coverage

## Context

We fixed several transcript monitoring bugs this session that went undetected:
1. `lsof` not in LaunchAgent PATH
2. Claude Code rotating session IDs mid-session
3. Accept/reject key aliases sending wrong keys
4. sendText not pressing Enter in Claude Code's TUI

The shared E2E harness covers command routing and key aliases but never exercises `watchTranscript()`. The only transcript E2E is `e2e-tmux-claude.test.ts` which requires a live Claude session.

## Goal

Add transcript monitoring tests to the shared harness using synthetic JSONL files — no live Claude needed.

## Tests to add in `e2e-harness.ts`

### Transcript monitoring group

| Test | What it verifies |
|------|-----------------|
| Tool call posts status | Append tool_use record → MockPoster gets status message |
| End-turn posts response | Append end_turn text record → MockPoster gets response |
| Waiting for approval shows options | Append tool_use with stop_reason 'tool_use' → status includes accept/reject hint |
| Write .md posts snippet | Append Write tool_use for .md file → postSnippetToThread called |
| Forwarded text suppressed | recordForwardedText + user record → no duplicate post_user |
| Session rotation | Stale JSONL + newer sibling → reader switches to new file |

### Setup

- Create temp JSONL file in `beforeAll`
- Call `watcher.watchTranscript()` directly (bypass resolver)
- Use `monitor.tick()` for deterministic timing
- Assert via `MockPoster.messages`

### MockPoster changes

- Add `snippets: Array<{ threadTs, content, title }>` to track `postSnippetToThread` calls

## Files to modify

- `packages/daemon/src/e2e-harness.ts` — Add transcript test group + MockPoster.snippets
- `packages/daemon/src/watcher/manager.ts` — Expose transcript monitor for testing (or add a `tickTranscript()` method)

## Verification

```bash
pnpm --filter daemon exec npx vitest run src/transcript/
pnpm --filter daemon exec npx vitest run --config vitest.e2e.config.ts src/e2e-tmux.test.ts
pnpm test
```
