# 08: Global rate limiter with RPM/RPD/concurrency knobs

**What to build:** All model requests from all jobs pass through one durable limiter keyed by provider, honouring per-provider requests-per-minute, requests-per-day, and concurrency settings. A batch that cannot get a slot sleeps durably until one frees up, instead of hitting 429s.

**Blocked by:** 06 Settings: per-stage provider lists and prompts

**Status:** done

- [x] With RPM set to 2, no more than 2 requests per minute are sent to that provider
- [x] With RPD reached, no further requests go to that provider until its reset
- [x] Limiter counts survive a restart
- [x] Waiting batches show as sleeping with their wake time in the job view

**Context:** see `PLAN.md` at the repo root.
