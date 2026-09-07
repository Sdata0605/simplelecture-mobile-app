---
name: AI tab navigation gate (mobile)
description: How the mobile AI presentation "ready" gate works and why it has no provider.
---

# AI tab navigation gate (mobile)

The mobile AI-tab resilience layer (don't lose a slow AI answer) lives entirely
in `mobile/src/screens/TopicDetailsScreen.tsx` — there is NO React context/provider,
unlike the web version.

**Why no provider:** TopicDetails is a single native-stack screen whose in-screen
tabs are local state (not routes), so the answer + pre-fetched audio already
survive tab switches. The only real gap is leaving the *screen*, so a provider
would add risk with zero consumer benefit.

**How to apply / key facts:**
- Leaving is intercepted with `navigation.addListener('beforeRemove')`. On a
  native-stack screen this single hook catches header back, swipe back, AND the
  Android hardware back (all dispatch GO_BACK). No separate BackHandler needed.
- Gate only fires when: aiResponse present AND `blocked !== true` AND
  requiresConfirmation AND `!presentationStarted`. So blocked/off-topic and
  still-loading answers never gate.
- Discard path calls `clearAiJob()` (clears the ref) BEFORE
  `navigation.dispatch(e.data.action)` — the re-entrant beforeRemove then sees
  shouldGate=false, so no loop.
- beforeRemove closure reads **refs** (aiRequiresConfirmationRef etc.), not state,
  to avoid stale-closure bugs.
- "requiresConfirmation" is set only when the answer lands while the AI tab is
  NOT active (read via `activeTabRef.current`); that branch also arms a 15-min
  auto-expiry (`startAiExpiryTimer`) and shows a ready banner instead of autoplaying.
- Play-icon-on-entry: `loadSlideAudioPaused` loads slide-0 audio with
  `shouldPlay:false`; `togglePlayPause` has a fallback that fetch+plays the
  current slide on demand when `soundRef.current` is null (covers preload failure).
- All transitions log under the `[AIGate]` prefix.
