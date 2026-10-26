# 04: Docker image and README

**What to build:** The app ships as one Docker image containing the Node app, pandoc, Tesseract with Bangla data, and Noto Bengali fonts, storing everything under a `/data` volume. A README explains running it, connecting to Ollama on the host, and the Gemini free-tier data terms.

**Blocked by:** 03 Walking skeleton

**Status:** ready-for-agent

- [ ] `docker run` with a `/data` volume and an API key serves the UI and completes the walking-skeleton flow
- [ ] Stopping and restarting the container resumes an in-progress job
- [ ] Healthcheck reports healthy once the server is up
- [ ] README covers run instructions, Ollama via `host.docker.internal`, and that free-tier Gemini inputs may be used for training/human review

**Context:** see `PLAN.md` at the repo root.
