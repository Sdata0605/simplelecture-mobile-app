---
name: Student notes nullable aggregate
description: Safe persistence rule for aggregate chapter notes whose topic context is null.
---

Do not rely on a PostgREST composite `on_conflict` containing nullable `topic_id` when saving aggregate chapter notes. Read/update aggregate rows with an explicit `topic_id=is.null` filter and use deterministic update-first semantics.

**Why:** Standard PostgreSQL uniqueness treats nulls as distinct unless the backing unique index explicitly uses `NULLS NOT DISTINCT`; otherwise repeated aggregate upserts can silently create duplicate chapter notebooks.

**How to apply:** Lecture/topic rows may use their fully non-null composite conflict context. For aggregate rows, PATCH the exact student/job/subject/chapter/null-topic scope first, insert only when absent, and handle concurrent-insert conflicts by retrying the exact PATCH.