---
name: study-timetable-ai edge function contract
description: Payload shapes the mobile AI-plan wizard must send to the deployed study-timetable-ai Supabase edge function (NOT in repo).
---

# study-timetable-ai edge function contract

The `study-timetable-ai` Supabase edge function is **deployed only** — it is NOT in
`supabase/functions/` in this repo (only `sarvam-stt` is). The function is the source
of truth; the mobile wizard (`AIAutoTimetableModal` in
`mobile/src/screens/StudyTimetableScreen.tsx`) must conform to it.

**Why:** You cannot read the function's code here; you can only conform to the
documented contract. Treat it as a fixed external API.

## Payloads (camelCase)
- `evaluate_feasibility`: `{ action, scopeLabel, contentDurationMinutes, deadline (local YYYY-MM-DD), dailyHours }` → response `{ verdict: 'too_short'|'ok'|'generous', message }`.
- `generate_plan`: `{ action, courseId, scopeLabel, scopeType('course'|'subject'|'chapter'|'topic'), scopeId(null for course), deadline(local YYYY-MM-DD), weekday/saturday/sunday:{intervals:[{label,start,end}]}, items[], feedbackMessage?, pattern('sequential'|'pair'|'mixed') }`.

## Critical gotchas
- `items[]` is the load-bearing field: the function iterates it to create sessions.
  **Empty items = blank calendar.** Each item: `{ id:'topic-<uuid>', title, durationMinutes, subject_id, chapter_id, topic_id }`. Build items from topics in scope; prefer topics that have a published AI lecture (`video_generation_jobs` joined `ai_assistant_documents` on topic_id, `is_published=true & status=completed`), but fall back to all topics so the plan never generates blank.
- `studentId` is **derived from the JWT** — do not gate generation on a client userId; just send the auth token via the functions endpoint.
- `deadline` must be **local** YYYY-MM-DD (use a local formatter, not `toISOString()`), or sessions land on the wrong day.
- `dailyHours = Math.round((weeklyMinutes/7)/60) || 1` where weeklyMinutes = weekdayMin*5 + satMin + sunMin.
- Day plan intervals use labels `morning|afternoon|night`; only include enabled windows with `start < end`.

**How to apply:** Any change to the mobile study-plan wizard payload must match these
shapes exactly; verify against the deployed function, not a local copy.
