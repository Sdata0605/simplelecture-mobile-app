---
name: MCQ question text embeds duplicate options
description: Why MCQ question_text is sanitized at display time instead of in the data
---

Some MCQ rows arrive with the answer choices already listed inline inside the
question text (e.g. "- (a) OH⁻  - (b) H⁺ ...") AND separately in the `options`
field that renders the selectable A/B/C/D cards. Showing both is redundant.

**Decision:** Strip the inline choices at display time via
`stripEmbeddedOptions(text, options)` in `mobile/src/utils/questionText.ts`,
NOT by editing the stored data or the question-generation backend.

**Why:** The fix must work for already-stored questions without a migration, and
the source of the duplication (AI question generation) is out of scope/owned
elsewhere. Display-side is safe and reversible.

**How to apply:**
- The helper only removes a line when its content matches an actual option value
  (normalized to letters/numbers), and only when ≥2 such lines are found — so it
  is a no-op for clean questions and non-MCQ questions. Keep this value-matching
  guard; do not loosen it to a pure label-pattern strip or legitimate numbered
  question content can disappear.
- Wrap every place that renders a question's text next to separate options with
  this helper (test runner + Questions/DPP/Assignment views in
  TopicDetailsScreen). If new MCQ render sites are added, wrap them too.
