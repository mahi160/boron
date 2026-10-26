# 11: Library and multi-book queue

**What to build:** A library screen lists all books with status, progress, and quota countdown. Several books can be queued; their jobs share the global limiter fairly.

**Blocked by:** 05 Live job view over SSE; 08 Global rate limiter

**Status:** ready-for-agent

- [ ] Library shows every book with status and progress
- [ ] Two queued books both make progress under the shared limits without exceeding them
- [ ] Deleting a book removes its files and job state

**Context:** see `PLAN.md` at the repo root.
