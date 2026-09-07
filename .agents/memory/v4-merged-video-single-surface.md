---
name: V4 merged video single surface
description: Why the V4 native video player must keep only one live expo-av Video decoder surface on Android.
---

# V4 merged-video player: one decoder surface only

Mounting two live `expo-av` `<Video>` decoders at once on Android (the old
double-buffer A/B "instant swap" design) crashes with:
`setSurface()/queueInputBuffer() is valid only at Executing states; currently at Released state`.
When the hidden standby slot releases its MediaCodec surface mid-stream, the
error fires on every section load.

**Rule:** drive the V4 teaching video with a SINGLE `<Video>` and swap its
`source` per section. Do NOT add a second live Video for pre-buffering.

**Why:** the V4 preload manager already downloads upcoming sections to the
on-disk cache (`file://`), so swapping the single surface to a local file is
fast enough — the second decoder was redundant and was the crash source.

**How to apply:** any "smooth the transition" work (e.g. follow-up fade) must
stay single-surface — use opacity/overlay fades, not a second mounted Video.
Keep a remote-HTTPS fallback if a cached `file://` source fails to decode.
The intro/summary sections (index 0,1) feed the avatar clip into this same
player directly (no chroma keying); index 2+ feed the merged final video.

## Direct-load path must load the requested URL, not the avatar fallback
The WebView player's `exec('load')` has 3 paths: fast (standby matched → doSwap),
slow (standby still buffering), and direct (standby missing/mismatched). The direct
and slow-error branches used to load `currentFallbackUrl` (the AVATAR) instead of the
requested `loadUrl` (the FINAL). Result: any section whose standby buffer wasn't
pre-warmed silently played the avatar with NO error and NO fallback log.

**Why it hid:** content sections each carry a quiz, and the next-section prefetch is
skipped whenever the current section has a quiz. So only the FIRST content section
(pre-warmed during the quiz-less summary) hit path:fast and played its final; every
later content section hit path:direct and played the avatar.

**Rule:** `currentFallbackUrl` (avatar) is reserved for `onError` only. The fast/slow/direct
load paths must all target the requested primary URL. A missing standby buffer is a
cache miss, not a reason to substitute the avatar.

## RN section overlays only belong on avatar-driven sections (intro/summary)
`V4SectionScene` (intro title, summary bullets, memory cards, recap) is NOT auto-wired —
the player must explicitly render it. Render it ONLY for sections that play the bare avatar
clip (intro idx0, summary idx1). Sections that play the merged FINAL video (content/memory/
recap, idx2+) already have their visuals composited in — adding an RN overlay there double-
layers the same content.

**Why:** the summary-bullets-not-showing bug was simply that `V4SectionScene` was defined but
never mounted in the new player. Gating its mount on `section_type === 'summary'` fixes it
without re-introducing overlays on the baked-in final-video sections.

**How to apply:** drive summary bullet reveals off the player's real `currentTime`/`duration`
(the avatar's WebView video clock), not wall-clock timers, so pause/seek/speed stay in sync;
keep reveal count monotonic and force-show all bullets near end-of-section.
