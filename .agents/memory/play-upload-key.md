---
name: Play Store upload key reset
description: The current Android upload key is a RESET key; production AABs must be signed with the local keystore that matches it.
---

# Play Store upload key was reset (twice)

The ORIGINAL Play upload key was lost; upload-key resets were done via Play Console
support tickets. Google activates a reset key at a scheduled time — until activation,
an AAB signed with the new key is REJECTED on upload; after activation it is accepted.

## Current upload key (second reset, July 2026) == the local keystore in this repo
After the July 2026 Expo account move, a SECOND reset was submitted. The current
`mobile/android_keystore.jks` (alias `simple-lecture`, file dated 2026-07-17) matches
`attached_assets/upload_certificate_new_*.pem`: SHA-256
`71:9E:53:72:8D:84:0E:DB:1C:99:12:B8:55:68:9A:77:76:86:9A:8F:38:9E:93:E6:96:74:66:47:EB:42:F2:E8`.
(The older 2B:AB:… cert from the June reset is obsolete.) Keystore password is the one
embedded in `mobile/credentials.json` — NOT the ANDROID_KEYSTORE_PASSWORD secret, which is stale.

## Rule for production builds
**Production AABs MUST be signed with this local keystore** — keep the production
profile on `credentialsSource: local` (reads `mobile/credentials.json` +
`android_keystore.jks`). Do NOT let EAS generate/use a remote keystore for production,
and do NOT regenerate a fresh keystore — either would break Play upload (cert mismatch).
**Why:** Play only accepts uploads signed by the registered upload key; this local
keystore is now that key. The Expo account switch does not affect this because local
credentials are independent of the Expo account.

## Verify a build matches before uploading
`openssl x509 -in <upload_cert>.pem -noout -fingerprint -sha256` must equal the keystore's
SHA-256 (get it via `keytool -list -v -keystore android_keystore.jks -alias simple-lecture`,
password from `credentials.json`).
