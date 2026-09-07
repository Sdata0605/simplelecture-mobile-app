---
name: Self-tests (My Tests) durable rules
description: Non-obvious decisions for scheduled self_tests in the mobile "My Tests" hub, distinct from DPP/PYQ.
---

# Self-tests ("My Tests" hub)

Scheduled student self-tests are a distinct feature from DPP and PYQ (which live in their own screens). They have their own header / question-snapshot / answer tables.

## Durable rules
- **Status is derived from time, never the DB `status` column.** upcoming/live/missed/submitted comes from comparing now against the schedule window (start + duration) plus `submitted_at`.
  - **Why:** the DB status column is not reliably maintained; the schedule window is the source of truth.
- **The answer key is the snapshot question row id (`self_test_questions.id`), not the source `questions.id`.** Upsert answers on conflict `(self_test_question_id, student_id)` so re-submits/re-grades replace rather than duplicate.
- **MCQ options arrive in three shapes** (`{A:'text'}`, `{A:{text}}`, or array) — always normalize before rendering.
- **Grading is split:** MCQs are graded on-device; written answers are OCR'd (only when image-only) then AI-graded via edge functions.
- **Exam-window + single-submit enforcement is client-only.** Server-side enforcement (RLS/edge) is a known integrity gap, not implemented.
