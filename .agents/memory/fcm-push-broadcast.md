---
name: FCM push broadcast & stale-token cleanup
description: Rules for broadcasting FCM v1 pushes to all devices and safely pruning dead tokens.
---

# FCM push broadcast (Supabase edge functions)

The app uses Firebase **FCM** (`@react-native-firebase/messaging`), not Expo push.
Device tokens live in `user_push_tokens(id, user_id, fcm_token, platform)`. Tokens are
registered on every login (`AuthContext` → `registerFcmToken`). Broadcasts iterate the
table and POST one FCM HTTP v1 message per token (v1 has no multicast on the
`messages:send` endpoint); cap concurrency (~100) with `Promise.allSettled`.

FCM v1 `message.data` values MUST all be strings — keep the payload flat
(`type`, `screen`, `blogSlug`, …). The app tap handler routes on `data.screen` +
`data.blogSlug`; do NOT nest objects in `data`.

## Stale-token cleanup — only delete on UNREGISTERED
**Rule:** when pruning dead tokens, delete a row ONLY when FCM's structured error
`error.details[].errorCode === 'UNREGISTERED'`. Never delete on a bare HTTP 404 or on
`INVALID_ARGUMENT`.

**Why:** a malformed message payload returns `INVALID_ARGUMENT` (and some configs a 404)
for EVERY token in the batch. A broad "404 or INVALID_ARGUMENT ⇒ stale" rule would then
wipe the entire `user_push_tokens` table on a single bad deploy. `UNREGISTERED` is the
only code that unambiguously means "this specific device token is dead" (app uninstalled).

**How to apply:** parse the FCM error JSON, read `errorCode` from `error.details[]`
(fall back to `error.status`), and gate the delete on `=== 'UNREGISTERED'`. Log-and-retain
everything else.
