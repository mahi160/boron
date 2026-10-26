# 05: Live job view over SSE

**What to build:** While a book runs, the user watches it live: the job's stages (render, batches, assemble, epub), each batch's state, the provider/model in use, retries and backoffs, and token usage update in real time from pi-durable's task graph and conversation views streamed over SSE.

**Blocked by:** 03 Walking skeleton

**Status:** ready-for-agent

- [ ] Batch states change in the UI without reload as the job progresses
- [ ] Retries/backoff and token usage per job are visible
- [ ] Reconnecting or opening the page mid-job shows the current state

**Context:** see `PLAN.md` at the repo root.
