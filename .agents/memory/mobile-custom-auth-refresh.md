---
name: Mobile custom Supabase auth refresh
description: How session/JWT persistence is kept alive in the mobile app's hand-rolled Supabase auth layer (not supabase-js).
---

The mobile app does NOT use supabase-js session management. It rolls its own auth: raw `fetch` against the GoTrue/proxy endpoints, tokens in AsyncStorage. `SUPABASE_URL` is a Cloudflare worker proxy that drops idle connections (~150s) and can emit transient 4xx/5xx.

**Three layers keep a user logged in until explicit logout / app deletion:**
1. **Proactive (primary):** the single token accessor refreshes before returning whenever the access token is expired or near expiry, with a short cooldown after a failed refresh. Refresh is single-flight (one shared in-flight promise) so concurrent callers can't burn the one-time refresh token.
2. **Reactive (backstop):** a global `fetch` interceptor that, ONLY for our authenticated requests to the Supabase proxy (Bearer = the user's access token, not the anon key), transparently refreshes once and retries the original request on a 401. This covers every call site uniformly without editing them. Guard against loops with a one-shot retry marker on the request init; skip anon-key requests.
3. **Keepalive:** AuthContext refreshes on AppState 'active' and on a recurring interval while logged in. Coarser than (1)/(2), so it's only a guard.

**Why these specific design rules (the non-obvious parts):**
- **Every token read must funnel through the proactive accessor / shared helper.** Any module that reads the stored token from AsyncStorage directly bypasses proactive refresh and can send a stale JWT — that was the original bug.
- **Only force logout on explicit invalid-grant / refresh-token signals in the error body — never on a bare HTTP status.** The proxy emits transient 4xx/5xx; status-based invalidation causes false logouts. Keep the stored session on network/timeout failures.
- **Keep the refresh timeout generous (tens of seconds, not single digits).** A too-short abort can cancel a server-side token rotation mid-flight, corrupting the session.
