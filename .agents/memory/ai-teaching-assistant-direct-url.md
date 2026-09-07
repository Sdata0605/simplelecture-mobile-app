---
name: AI Teaching Assistant direct Supabase URL
description: Why askAITeachingAssistant bypasses the Cloudflare worker proxy, and the response-shape contract the screen relies on
---

# AI Teaching Assistant uses the direct Supabase URL, not the worker proxy

`mobile/src/services/supabase.ts` has TWO base URLs:
- `SUPABASE_URL` — Cloudflare worker proxy (`...workers.dev`). Used by ALL Supabase calls EXCEPT one.
- `SUPABASE_DIRECT_URL` — the project URL (`https://<ref>.supabase.co`, same project/ref as the anon key). Used ONLY by `askAITeachingAssistant`.

**Why:** the worker proxy drops idle connections at ~150s. AI Teaching Assistant answers take 30s–5min, so slow ones were cut off. The direct call has no such idle cap; it's guarded by a 420s `AbortController` client timeout instead.

**How to apply:**
- Don't naively move other calls to the direct URL, and don't move this one back to the proxy. Any new long-running (>150s) call should also go direct + AbortController.
- Response shape varies: the direct endpoint returns the upstream Python API verbatim (snake_case: `presentation_slides`, `key_points`, `slide_audio_urls`, `narration_text`, `is_story`, `infographic_url`); the legacy proxy shape was camelCase. `normalizeAITeachingResponse()` maps BOTH into the uniform `AITeachingAssistantResponse`/`PresentationSlide`.
- Invariants the player (`TopicDetailsScreen.tsx`, nav gate #243) depends on — keep them if you touch the normalizer: `keyPoints` is ALWAYS an array (screen does `currentSlide.keyPoints.length`/`.slice()` with no optional chaining); `blocked===true` short-circuits with empty slides; slides are filtered to those with ≥1 keypoint, falling back to all if that empties the list.

## Media lives in TOP-LEVEL maps, not per-slide fields
Manim videos come ONLY as top-level `manimVideoUrls` keyed by 0-based raw-slide-index
string (`{"1": {url, duration_seconds}}`); slide images duplicate in top-level `imageUrls`.
No per-slide `manimVideoUrl` from upstream — the normalizer overlays the map onto slides
BEFORE the key-point filter (keys use raw upstream order). Cached (L1_redis) responses are
camelCase; fresh ones snake_case — handle both. The endpoint accepts the anon key as
Bearer, so questions can be replayed from the sandbox with curl.

## expo-file-system downloadAsync THROWS in SDK 54
`downloadAsync` (and friends) from the root `expo-file-system` import throw their
deprecation message as a runtime Error — all AI slide audio/image/video downloads
silently failed (silent slides, 0 media cached). Import `expo-file-system/legacy`
instead (has cacheDirectory/EncodingType typings too). Other services
(v3/v4PlayerService, videoCacheService) still use the root import.
