---
name: Student notes Realtime editor
description: Realtime note sync must preserve the mounted editor and reject stale-context events.
---

Never route `student_lecture_notes` Realtime events through the initial/context loading flow. Reconcile matching events directly in the mounted editor, ignore identical self-save echoes, and protect pending local edits.

**Why:** Toggling initial loading replaces the text input, dismisses the keyboard, and interrupts every autosave. Async events from a previous chapter can also overwrite the newly selected chapter unless context identity is checked after awaits.

**How to apply:** Keep loading state for first hydration/context changes only. Reset visible text and pending refs before painting a new context; an empty or failed context must never inherit the prior note. Background loads, saves, and events must compare full user/job/subject/chapter/topic identity before and after async work, then apply, clear, fetch silently, or ignore without unmounting the editor.