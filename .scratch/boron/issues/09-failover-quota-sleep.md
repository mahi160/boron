# 09: Provider failover and quota sleep with countdown

**What to build:** When a provider returns a rate-limit or quota error, the batch fails over to the next provider in the stage's list. When every provider is exhausted, the job sleeps durably until the configured quota reset time (default midnight Pacific) and resumes on its own, with a countdown in the UI.

**Blocked by:** 08 Global rate limiter

**Status:** ready-for-agent

- [ ] A daily-quota error marks that provider exhausted until reset and the batch continues on the next provider
- [ ] A per-minute 429 backs off and retries the same provider rather than failing over
- [ ] With all providers exhausted, the job shows a countdown and resumes after reset, including across a container restart
- [ ] Reset time and timezone are configurable

**Context:** see `PLAN.md` at the repo root.
