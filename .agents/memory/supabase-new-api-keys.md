---
name: Supabase new API keys vs edge function auth
description: Why service-role-gated edge functions 401 the legacy JWT; they now expect the sb_secret_ key.
---

# Supabase project migrated to new API key format

The project `oxwhqvsoelqqsblmqkxx` uses Supabase's **new API keys**. There are now
four keys (verify via Management API `GET /v1/projects/{ref}/api-keys?reveal=true`
with a `sbp_` personal access token):

- `anon` (legacy JWT, ~208 chars, `eyJ…`)
- `service_role` (legacy JWT, 219 chars, `eyJ…`)
- `default` publishable (`sb_publishable_…`, ~46 chars)
- `default` secret (`sb_secret_…`, 41 chars)

**Key fact:** the value auto-injected into edge functions as
`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` is now the **41-char `sb_secret_` key**,
NOT the legacy 219-char service_role JWT.

**Why this matters:** `send-push-notification` (and any edge function that gates on
`authHeader !== "Bearer " + Deno.env('SUPABASE_SERVICE_ROLE_KEY')`) will return
`401 {"error":"Unauthorized"}` if you call it with the legacy service_role JWT. You
must call it with the `sb_secret_` key. The legacy JWT still works for REST
(`/rest/v1/...`) and admin (`/auth/v1/admin/...`) endpoints for backward-compat,
which is the trap — those succeed, making the JWT *look* correct.

**How to apply:**
- To call a service-role-gated edge function, send `Authorization: Bearer <sb_secret_ key>`.
- Fetch the secret key at runtime (don't store another copy): Management API
  `GET https://api.supabase.com/v1/projects/oxwhqvsoelqqsblmqkxx/api-keys?reveal=true`
  with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`, pick `type === "secret"`.
- Redeploying the function does NOT fix the mismatch — the injected key is already the
  new secret key; the caller is what must change.

## Deploying edge functions from this sandbox
Local Docker bundling fails (`deno.land` DNS is blocked: "Temporary failure in name
resolution"). Use the Management-API bundler instead:
`cd <dir-with supabase/functions/<fn>> && SUPABASE_ACCESS_TOKEN=… npx -y supabase@latest functions deploy <fn> --project-ref oxwhqvsoelqqsblmqkxx --use-api`
Needs a `supabase/config.toml` containing `project_id = "..."`. Add `--no-verify-jwt`
only for functions that do their own auth and must be reachable without a valid JWT.

## Sending a test push (verified working 2026-06-27)
POST `/functions/v1/send-push-notification` with the `sb_secret_` bearer and body
`{user_id, title, body, data?, platform?}` → `{"succeeded":1}`. Resolve a user's
`user_id` from email via `/auth/v1/admin/users`; device tokens live in
`user_push_tokens(user_id, fcm_token, platform)`.
