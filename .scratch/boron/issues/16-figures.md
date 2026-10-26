# 16: Illustrations: detect, crop, adjust, embed

**What to build:** The vision model returns bounding boxes for illustrations on each page; the server crops them from the page render and places them in the EPUB at their position in the text with captions. On the review screen the user can move, resize, add, or delete boxes.

**Blocked by:** 12 Review screen; 13 Structured text and EPUB3 fidelity

**Status:** done (box editing is built but not tried in the browser on a page with an illustration; Gemini's box format is not yet checked on real pages)

- [x] A page with an illustration produces a cropped image in the EPUB at the right place
- [ ] Boxes are drawn on the page image in review and can be adjusted; the crop updates
- [x] Figure detection can be switched off in settings
- [ ] Box coordinate format of the chosen model is verified against real pages

**Context:** see `PLAN.md` at the repo root.
