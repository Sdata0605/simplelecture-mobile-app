---
name: AI player avatar↔section binding
description: How the AI Lecture Player keeps the speaking avatar bound to the displayed section under rapid prev/next switching.
---

# AI Lecture Player: avatar must stay bound to the displayed section

In `mobile/src/screens/AILecturePlayerScreen.tsx` the narrator avatar uses a dual
ChromaKeyVideo layer system (A/B) with only ONE live decoder allowed (see
`v4-merged-video-single-surface.md`). The hard part is keeping the *speaking* avatar
bound to the section currently on screen, especially under fast repeated prev/next taps.

## The rule
- Drive the section/avatar handshake through **synchronous refs**, not React state
  closures: a live mirror of active layer / per-layer URL / per-layer ready, a
  per-layer "which section index this layer's URL is for" tag, a `targetSectionIndexRef`
  (latest requested section) and a monotonic `transitionTokenRef`.
- A section switch must **supersede** (newest tap wins) — do NOT early-return when a
  transition is already in flight. Set target+token synchronously before any `await`,
  and after each `await` bail if your token was superseded.
- An avatar `onLoad` may only swap/play if its layer's section tag equals
  `targetSectionIndexRef` — otherwise it's a stale load and must be ignored.
- While a layer swap is pending, **gate the old active layer's playback-status events**
  (return early in the playback-status handler) AND pause both layers via
  `shouldPlay={... && pendingLayerSwap === null}`. Otherwise the still-mounted old
  avatar keeps narrating and its `onPlaybackStatusUpdate` advances the *new* section's
  beats/segment/section-end against the wrong timeline.
- The next-section prefetch effect must skip while a swap is pending or the target is
  unsettled, or it clobbers the inactive layer reserved for the pending target.

**Why:** content (section id) was switched on a fade timer while the avatar swap happened
later in `onLoad`/timeout with no section identity bound to the load; stale-closure layer
math + ungated old-layer status events made the avatar narrate a different section than the
one displayed, and rapid taps were dropped instead of superseding.

**How to apply:** any change to section navigation, the dual-layer swap, the prefetch,
or `handleAvatarPlaybackStatus` must preserve these invariants. Note the fullscreen
position-restore path short-circuits on `savedPositionRef.current !== null` and must
keep doing so before the section-tag checks run.
