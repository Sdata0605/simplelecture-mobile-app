---
name: Supabase Management API from this env
description: How to call the Supabase Management API (deploy fns, set secrets, run SQL) from the Replit sandbox.
---

# Supabase Management API (project ref oxwhqvsoelqqsblmqkxx)

Auth with `Bearer $SUPABASE_ACCESS_TOKEN` (personal `sbp_` token in Replit secrets).

Useful endpoints:
- List secret NAMES (values hidden): `GET /v1/projects/{ref}/secrets`
- Upsert a secret: `POST /v1/projects/{ref}/secrets` body `[{"name","value"}]` → 201
- Run SQL/DDL: `POST /v1/projects/{ref}/database/query` body `{"query": "..."}` (returns rows or `[]`)

## Use curl, NOT python urllib
**Quirk:** `api.supabase.com` is behind Cloudflare and blocks Python `urllib`'s default
User-Agent with **HTTP 403, Cloudflare error code 1010** ("browser signature banned").
`curl` works fine. If you must build a request body in Python (e.g. to embed a secret
without echoing it), write the body to a temp file locally and POST it with `curl -d @file`,
then `rm` the file. Never put a secret value as a literal in the shell command (it lands in
the transcript) — keep it in an exported env var and let Python/curl read it from env.

## Deploying edge functions from here
Local Docker bundling fails (`deno.land` DNS blocked), so deploy with the Management-API
bundler: from a dir containing `supabase/config.toml` (`project_id = "<ref>"`) and
`supabase/functions/<fn>/index.ts`, run
`SUPABASE_ACCESS_TOKEN=... npx -y supabase@latest functions deploy <fn> --project-ref <ref> --use-api --no-verify-jwt`.
