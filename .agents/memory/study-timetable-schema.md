---
name: Study Timetable Supabase schema
description: Real column shape of study_timetables/self_tests vs what mobile code assumed
---

The mobile Study Timetable read from flat columns that do not exist, causing blank plan cards.

Verified live schema:
- `study_timetables`: `id, student_id, course_id, mode, plan_metadata (json), is_active, created_at, updated_at`.
  - `mode` is `'auto'` | `'manual'` (NOT `'ai_auto'`).
  - Human-readable plan info lives INSIDE `plan_metadata`: `scopeLabel` (title), `deadline`, `scopeType`, `scopeId`, `pattern`, `items`, `tzOffsetMinutes`. Manual plans have empty `plan_metadata {}`.
- `self_tests`: question count is `total_questions` (NOT `question_count`); scope is `chapter_ids` / `topic_ids` arrays (NOT `scope_ids`); scoring is `mcq_score`/`written_score`/`total_score`/`percentage` (no `score`).
- `study_timetable_sessions`: top-level `title, scheduled_at, subject_id, ...` already match — calendar session chips work directly.

**Why:** Calendar/plan cards rendered blank because the TS interfaces invented flat columns.
**How to apply:** When touching timetable plans/tests in mobile, read plan_metadata for title/deadline/scope, treat mode as 'auto'/'manual', and use total_questions + chapter_ids/topic_ids for self_tests. Bucket calendar items by LOCAL date (sessions stored UTC) to avoid IST-evening day shift.

## create-self-test edge function contract
The `create-self-test` Supabase edge function expects **camelCase** keys (NOT the snake_case DB column names): `{ courseId, subjectId, testType, chapterIds, topicIds, title, scheduledAt, durationMinutes }`. It generates the questions itself — there is no client question count. It returns an error JSON like `{ error: "..." }` (e.g. no questions for the scope), so surface `JSON.parse(message).error` to the user.
- Topic-mode scope: parent chapter goes in `chapterIds` (binds the calendar entry) and selected topics go in `topicIds`. Chapter mode: chapters in `chapterIds`, `topicIds` empty.
**Why:** A previous version posted snake_case + total_questions then fell back to a direct `self_tests` insert with no questions, producing empty tests. There is no client-side insert path — always go through the edge function.
