---
name: AI presentation playback teardown
description: Why stopping the slide-narration audio needs a generation guard, not just unloading the current sound.
---
# Stopping AI presentation audio when leaving the screen

The AI tab's slide narration (`playSlideNarration` in `TopicDetailsScreen.tsx`) is a
**self-rescheduling chain**: each slide's audio `didJustFinish` creates the NEXT
slide's `Audio.Sound`, and silent slides schedule the next via `setTimeout`.

**The trap:** cleanup handlers (blur/unmount/tab-switch/close) that only
`stopAsync()/unloadAsync()` the *current* `soundRef` do NOT stop playback. A pending
`didJustFinish` callback or a queued `setTimeout` immediately creates a fresh sound,
so narration keeps going a few seconds after the user navigates away. Also
`Audio.Sound.createAsync(..., {shouldPlay:true})` is async — if teardown runs while a
`createAsync` is in flight, the new sound finishes loading and plays AFTER cleanup
nulled `soundRef` → an orphaned, unstoppable sound.

**Fix pattern (in place):**
- A monotonic `playbackGenerationRef` + a single `stopPresentationPlayback()` that
  bumps the generation, clears the tracked silent-advance timer
  (`silentAdvanceTimerRef`), stops+unloads `soundRef`, calls `Speech.stop()`, resets
  `isPlaying/isSpeaking`.
- `playSlideNarration`/`loadSlideAudioPaused` snapshot the generation on entry and
  re-check it after every `await` (audio mode, `createAsync` — unload the new sound
  if stale) and at the top of the `onPlaybackStatusUpdate` callback and before any
  auto-advance (both the `didJustFinish` and `setTimeout` branches).
- Funnel ALL teardown through `stopPresentationPlayback()`: `clearAiJob`, the
  `useFocusEffect` blur cleanup, the unmount effect, the AI→other tab-switch effect,
  the in-presentation close buttons, and the fullscreen Modal `onRequestClose`.

**Why:** bumping a generation invalidates the whole in-flight chain at once;
unloading one sound only kills one link.

**Also:** set `staysActiveInBackground: false` in the presentation
`setAudioModeAsync` calls and stop on `AppState` `background`/`inactive`, so audio
doesn't keep narrating once the app is backgrounded.
