---
name: AI presentation media preload symmetry
description: Why every per-slide media type in the AI presentation must be pre-downloaded, and how to gate playback without stalling startup.
---

# AI presentation media preload symmetry

In the AI presentation player (mobile `TopicDetailsScreen.tsx`, `presentAIResponse`), per-slide audio is pre-downloaded to `FileSystem.cacheDirectory` before playback so narration starts instantly from a local `file://`. Any OTHER per-slide media shown during playback (images: `infographicUrl` + `images[]`) MUST be preloaded the same way, or it lags behind the already-instant audio.

**Why:** audio loads from local cache (instant); a plain RN `<Image>` only network-fetches when its slide becomes active, so audio plays over a blank image. Reported as the "Watch Answer" audio-without-image bug.

**How to apply:** preload images CONCURRENTLY with audio (kick off downloads before the audio batch loop). Do NOT block playback on the whole deck — gate ONLY the first slide's image with a bounded `Promise.race([firstImageReady, timeout(~1.5s)])`, then start narration; keep downloading the remaining slides' images in the background, updating the cache map incrementally so later slides are ready by the time the user reaches them (slide narrations run several seconds). Render via a resolver that prefers the local cached URI, falling back to remote/base64; skip base64/data-URI. A per-slide spinner (keyed to currentSlideIndex) covers the timeout/fallback case. Clear the preload map in every reset path. Downloaded files (`ai_slide_*`, `ai_img_*`) are never pruned → cache-growth tech debt.
