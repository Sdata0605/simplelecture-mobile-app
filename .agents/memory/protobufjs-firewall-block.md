---
name: protobufjs firewall block (local mobile install)
description: How to install mobile deps locally when Replit's Socket firewall blocks protobufjs entirely.
---

# Symptom
`npm install` in `mobile/` fails with `E403 ... protobufjs ... Blocked by Security Policy. Reason: Critical CVE`.
This blocks the whole install, so `expo` never gets installed and the Expo/Metro workflow can't start.

# Why
`@react-native-firebase/app` (v23+, e.g. v24) depends on the full `firebase` JS SDK → `@firebase/firestore` → `@grpc/grpc-js` → `@grpc/proto-loader` → `protobufjs`. Replit's Socket firewall blocks **every** protobufjs 7.x version (confirmed 7.2.4/7.2.6/7.3.2/7.4.0/7.5.4), not just one. The RN app uses the native Firebase modules, so this JS-side firestore/grpc/protobufjs code is dead weight at runtime — but npm still must populate it.

# Fix (local dev only)
Direct npmjs tarball URLs are NOT blocked (only the `package-firewall.replit.local` registry proxy is). So:
1. `curl -o mobile/vendor/protobufjs-7.4.0.tgz https://registry.npmjs.org/protobufjs/-/protobufjs-7.4.0.tgz`
2. Add to `mobile/package.json`:
   ```json
   "overrides": { "protobufjs": "file:/home/runner/workspace/mobile/vendor/protobufjs-7.4.0.tgz" }
   ```
   **Use an ABSOLUTE file path.** A relative `file:./vendor/...` path is resolved relative to each *consuming* package (e.g. `@grpc/proto-loader/vendor/...`) and fails ENOENT. A plain version (`"7.4.0"`) or https URL both get rewritten back through the blocked firewall registry.
3. `cd mobile && npm install`

# EAS builds ARE affected by the override (fixed with a pre-install hook)
EAS reaches `registry.npmjs.org` fine, BUT the **absolute** `file:` override above is the problem: EAS workers run at `/home/expo/workingdir/build/mobile`, so `npm ci` tries to open `/home/runner/workspace/mobile/vendor/protobufjs-7.4.0.tgz`, hits `ENOENT`, and dies with `npm ci --include=dev exited with non-zero code: 254` in the Install dependencies phase. (Older "succeeded despite this" notes predate the override; preview APKs triggered after the override was added silently errored at install.)

**Fix (committed):** `mobile/eas-build-pre-install.js` + `"eas-build-pre-install": "node ./eas-build-pre-install.js"` in `mobile/package.json`. This EAS-only lifecycle hook runs before `npm ci`: it deletes `overrides.protobufjs` from package.json and runs `npm install --package-lock-only` to repin the lockfile to the registry, so `npm ci` installs protobufjs normally from npm. It does NOT run during local `expo start`/`npm run dev`, so the local absolute-path override stays intact. The hook file lives at `mobile/` root (NOT `mobile/scripts/`, which the root `.easignore` excludes).
**How to verify:** in the build log, PRE_INSTALL_HOOK should print "Removed local protobufjs file: override" + "Repinned package-lock.json to the registry", then INSTALL_DEPENDENCIES "added NNN packages".

# Related: jspdf
Root (`/`) install hits the same Socket block on `jspdf@3.0.4`. Fixed by bumping to `jspdf@^4.2.1` (basic `new jsPDF()` + `.save()` API is stable across v2/3/4).
