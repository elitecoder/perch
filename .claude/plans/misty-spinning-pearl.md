# Plan: Add transcript monitoring E2E coverage to shared harness

## Context

We just fixed two bugs in transcript monitoring that went undetected:
1. `lsof` not found in the LaunchAgent PATH (`/usr/sbin` missing)
2. Claude Code rotating session IDs mid-session, leaving the resolver attached to a stale JSONL

The shared E2E harness (`e2e-harness.ts`) covers command routing, key aliases, and thread forwarding, but **never exercises `watchTranscript()`** — it only tests the fallback `registerWatch()` path because no real Claude process runs during those tests. The only transcript E2E is `e2e-tmux-claude.test.ts`, which requires a live Claude session (90s timeout, real API calls).

## Goal

Add transcript monitoring coverage to the shared E2E harness **without requiring a live Claude process**. We can do this by writing a synthetic JSONL file and wiring the monitor to read it, so we verify the full pipeline: reader → formatter → ConversationalView → MockPoster.

## Approach

### 1. Add a `transcript integration` test group to `e2e-harness.ts`

New tests that:
- Create a temp JSONL file
- Call `watcher.watchTranscript(paneId, jsonlPath, poster, threadTs, plugin)` directly
- Append synthetic JSONL records to the file
- Trigger `monitor.tick()` (or wait for the interval)
- Assert `MockPoster.messages` contains the expected thread posts

### Tests to add:

| Test | What it verifies |
|------|-----------------|
| Tool call → status update | Appending a tool_use assistant record posts a status message |
| Final response → thread post | Appending an end_turn text record posts the response |
| Forwarded text echo suppression | `recordForwardedText()` + user record → no duplicate post |
| Session rotation | Stale JSONL + newer sibling → reader switches files |
| Long response → snippet upload | Response > 3000 chars triggers `postSnippetToThread` |

### 2. Extend `MockPoster` for snippet tracking

Add tracking for `filesUploadV2` calls so we can assert snippet uploads happen for long responses.

### 3. Add resolver unit tests for `findLatestJsonl`

Test that the resolver picks the most recently modified JSONL from a project directory, not the one matching `--session-id`.

## Files to modify

- `packages/daemon/src/e2e-harness.ts` — Add transcript test group
- `packages/daemon/src/transcript/monitor.ts` — Expose `_transcriptMonitor` or add test helper on WatcherManager
- `packages/daemon/src/transcript/resolver.test.ts` — Add `findLatestJsonl` tests

## Verification

```bash
pnpm --filter daemon exec npx vitest run src/e2e-harness.ts   # shared harness (if runnable standalone)
pnpm --filter daemon exec npx vitest run src/transcript/       # all transcript unit tests
pnpm test                                                      # full suite
```
