---
name: Auto chapter tests
description: How auto-generated chapter self-tests are created and surfaced after AI-lecture completion.
---

# Auto chapter tests

Completing the AI lecture for the last unwatched topic of a chapter creates an
achievement-style self-test. The flow lives in `useVideoCompletionTracker`:
watch-log insert -> award-badge -> (only if badge ok) check-chapter-completion
edge function. The server creates the self_test and the `auto_chapter_tests`
row; the client never creates tests.

**Rule:** the banner / "is this auto test still pending?" check must filter on
`self_tests.submitted_at IS NULL`, NOT on `auto_chapter_tests.status`.
**Why:** submitting a test (`submitSelfTest` in `useMyTests.ts`) patches the
`self_tests` row only — it does not update `auto_chapter_tests.status`. Relying
on `auto_chapter_tests.status` alone leaves the banner showing after a test is
taken.
**How to apply:** `useAutoChapterTests()` queries `status=neq.submitted` server
-side AND drops rows whose embedded `self_tests.submitted_at` is set.

**Edge case:** auto chapter tests reuse `deriveStatus` (schedule + duration),
so they can expire to `missed` and `MyTestTakeScreen` then blocks entry. These
are not time-boxed exams, so an expired-but-unsubmitted auto test routing to a
closed window is a known dead-end (tracked as a follow-up).
