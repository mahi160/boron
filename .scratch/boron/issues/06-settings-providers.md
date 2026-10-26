# 06: Settings: per-stage provider lists and prompts

**What to build:** A settings screen configures, per stage (OCR, proofread, assemble), an ordered list of providers: OpenAI-compatible (base URL, key, model) or native Gemini, plus editable prompts and pipeline knobs. A test button checks a provider with a sample page. Changes apply to new requests without a restart.

**Blocked by:** 03 Walking skeleton

**Status:** done (a model change in the middle of a job is untested: settings are read at every request)

- [x] User can add Gemini (native and OpenAI-compatible endpoint) and an Ollama provider and reorder them per stage
- [x] Test button reports success or the provider's error for a sample image
- [ ] Changing the model mid-job applies to the next batch request
- [x] API keys are never shown in full after saving and never logged

**Context:** see `PLAN.md` at the repo root.
