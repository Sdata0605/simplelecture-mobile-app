---
name: Mobile "session never ends on its own" invariant
description: Rules that keep a logged-in mobile user logged in except on explicit logout or a definitive invalid_grant.
---

# Session must never end on its own

A logged-in user may be logged out ONLY by explicit logout or a definitive
invalid/revoked refresh-token signal. Never by token expiry, app relaunch, flaky
network, transient 4xx/5xx, or normal refresh-token rotation.

Concrete rules baked into `mobile/src/services/supabase.ts` + `AuthContext.tsx`:

- `refreshSession`/`_performRefresh` must treat network/timeout/abort/5xx and even a
  **storage write failure** as TRANSIENT: return `{success:false}` (no `invalidRefreshToken`,
  no `notifySessionInvalid`) — it must NEVER throw. **Why:** an unhandled rejection bubbling
  into `AuthContext.checkAuth`'s catch used to `setUser(null)` = silent logout.
- Only force re-login on definitive signals: `invalid_grant` / `refresh_token_*` error
  CODES, or an invalid/expired/revoked refresh-token description **gated to HTTP 400/401**.
  Do NOT broaden to a bare "refresh token" text match (transient bodies mention it too).
- `AuthContext.checkAuth` catch must NOT `setUser(null)` — preserve the restored user;
  logout is owned solely by explicit logout and the session-invalid handler.
- Every login path (password login, signup token-return branch, Google, phone OTP, email
  OTP) must REFUSE an access-token-without-refresh-token "half-login" (it would die at next
  expiry). Exception: OTP signup-verify-first legitimately returns NO tokens → still success.
- `saveTokens` never overwrites a good stored refresh token with a blank one; writes both
  tokens via one `multiSet` (batched, shrinks but doesn't eliminate the rotation-race window).

**How to apply:** when touching any auth/refresh/logout path, re-check it against these
rules and run `cd mobile && npm test` (see mobile-jest-harness.md). Server-side Supabase
settings also matter: refresh-token reuse-revocation must be OFF / interval generous, and
session time-box / inactivity timeouts at 0 — see replit.md "Auth Persistence".
