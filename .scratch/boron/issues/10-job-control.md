# 10: Job control: pause, abort, retry, parked pages

**What to build:** The user can pause, resume, and abort a book job from the UI. Batches that repeatedly crash the process are parked (restart limit) and shown with a retry button; a killed container resumes unfinished work by itself.

**Blocked by:** 05 Live job view over SSE

**Status:** ready-for-agent

- [ ] Pause stops new requests; resume continues from where it stopped
- [ ] Abort stops the job and leaves completed pages intact
- [ ] A parked batch is visible with its reason and can be retried
- [ ] Killing the container mid-job and starting it again resumes without duplicate requests

**Context:** see `PLAN.md` at the repo root.
