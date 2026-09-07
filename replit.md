# Simple Lecture - E-Learning Mobile App

## Overview
Simple Lecture is an e-learning mobile application providing an engaging and comprehensive educational experience. It offers course browsing, personalized learning paths, detailed progress tracking, and interactive AI-powered assistance. The project aims to be a cutting-edge educational tool integrating modern features for an advanced learning environment.

## User Preferences
I prefer iterative development with clear communication on progress. Please ask before making any major architectural changes or introducing new libraries. Ensure all solutions are mobile-first and responsive.

## System Architecture

### UI/UX Decisions
The application features a mobile-first design with a consistent green/mint theme (`#2BBD6E`), gradients, and shadows. It utilizes Shadcn UI (Radix UI primitives) with Tailwind CSS for components and Framer Motion for transitions. Key UI elements include fixed bottom navigation, a slide-out sidebar, rounded cards, gradient headers, and elevated search bars. Typography uses Lora for headings and Inter for body text, inspired by a Udemy-style editorial look. Course cards display thumbnails, titles, descriptions, ratings, prices, and optional bestseller badges.

### Technical Implementations
The mobile app is built with Expo SDK 53 (React 19.0.0, React Native 0.79.6). The web frontend uses React, TypeScript, Wouter for routing, and TanStack Query for state management. The backend is an Express.js server with a PostgreSQL database via Drizzle ORM. `expo-file-system` is used for video caching.

### Feature Specifications
- **Onboarding & Authentication**: Multi-step onboarding with Phone OTP, Email OTP, Email+Password, and Google Sign-In. OTP verification and password recovery are included. User interests are selected post-signup for content personalization.
- **Course Management**: A 3-level category hierarchy, detailed course views, and enrollment via a cart system.
- **Personalized Learning**: Dashboards, learning paths, and progress tracking.
- **Interactive Learning**: Topic details with video lessons, resources, quizzes, and an AI Teaching Assistant featuring rich slides, diagrams, and audio narration.
- **Assessments**: Configurable MCQ tests, Daily Practice Problems (DPP) with AI grading, and a Results tab for performance history.
- **Learning Content Tabs**: Standardized tabs per document (Classes, AI, Questions, Assignments, DPP, PYQ's, Results, Doubts) with specific functionalities.
- **User Profile & Cart**: Comprehensive profile management, settings, and an e-commerce cart.
- **Recordings**: A "My Recordings" section with search, filters, progress tracking, quality selection, and HLS streaming.
- **Detailed Progress**: Extensive student data overview across multiple tabs (Overview, My Progress, My Tests, My Attendance, My Timetable, My Courses, AI & Learning, My Engagement).
- **Navigation**: Fixed bottom navigation bar.
- **Doubts Tab (AI Chat)**: AI-powered Q&A chat for subject-specific questions, supporting multi-turn conversations and markdown rendering.
- **Forum System**: Q&A discussion platform with categories, posts, replies, upvoting, and AI-generated reply badges.
- **Blog**: Blog listing and detail screens with content from Supabase.
- **Language Top-Up System**: Allows purchasing regional language access for AI lectures, supporting 13 Indian languages plus English, integrated with Razorpay.
- **GST (18%)**: Applied to course prices in the Cart/Checkout flow.
- **Video Completion & Badge Cascade**: Tracks AI lecture watch time, awarding badges (Bronze, Silver, Gold, Master, Course Complete) based on completion thresholds.
- **My Rewards Screen**: Displays badge summary, certificated course completions, and a full badge list.

### Testing
- **Mobile unit tests (Jest)**: Jest runs in `mobile/` (config `mobile/jest.config.js`, `node` env, `babel-preset-expo` transform, AsyncStorage mapped to an in-memory mock; `testMatch` = `src/**/__tests__/**/*.test.ts`). Run with `cd mobile && npm test`. The harness is intentionally lightweight: tests may only import modules whose transitive imports stay RN-free (importing anything that pulls in `react-native` will fail in the node env). 8 suites / 81 tests total.
  - **Auth lifecycle** (`src/services/__tests__/authSession.test.ts`, 19): auto-refresh on expiry, cold start, transient network/5xx/400 keep-session, definitive invalid_grant logout, 401 refresh-and-retry, single-flight concurrency, rotation, interrupted-save recovery, long inactivity, and half-login refusal across password/Google/phone-OTP/email-OTP/signup.
  - **Tier 1 pure-logic** (62 across 7 suites): pricing/GST + promo discount (`payment.ts`), MCQ embedded-option stripping (`questionText.ts`), media URL resolution — YouTube id / path resolve / job-id / CDN proxy (`mediaResolver.ts`), calendar/date helpers (`utils/calendar.ts`), V4 player gating (`lib/playerSelection.ts`), self-test status + option normalization (`hooks/useMyTests.ts`), and dashboard subject colors (`hooks/useDashboardStudyPlan.ts`).
  - **Supporting refactors (zero behavior change)**: calendar helpers (`planScopeLabel`, `buildCalendarGrid`, `datePrefixForDay`, `localDateKey`, + private `dayOfWeekMon`/`getDaysInMonth`) were extracted verbatim from `StudyTimetableScreen.tsx` into the RN-free `mobile/src/utils/calendar.ts` (screen now imports them) so they are testable; `colorForSubject` gained an `export`.
  - **Lockfile note**: the Jest install poisoned `mobile/package-lock.json` with 119 `package-firewall.replit.local` `resolved` URLs; rewritten to `https://registry.npmjs.org/` to keep EAS cloud builds working (see memory `eas-builds.md`).

### System Design Choices
- **Data Flow**: Frontend interacts with APIs, some directly with Supabase.
- **Performance**: Utilizes parallel data fetching and optimized rendering.
- **Robustness**: Includes error handling, loading, and empty states.
- **Media Handling**: CDN proxy for image and video rendering, with specific handling for thumbnails and beat images.
- **AI Lecture Player Architecture**: A 4-layer rendering system for synchronized content and AI avatar narration (background, content, avatar, video overlay).
- **Portrait Mode Layout**: Unified design with a header bar, 16:9 stage, controls bar, and quick actions grid.
- **Content Display Pattern**: Single-beat display for content/example sections; progressive accumulation for summary sections.
- **Timing System**: Avatar video acts as the master clock for content reveals.
- **Section Types**: Seven distinct section types (INTRO, SUMMARY, CONTENT, EXAMPLE, QUIZ, MEMORY, RECAP) with specific choreographies.
- **Teach/Show Pattern**: Alternating phases for avatar narration ("TEACH") and full-screen animations ("SHOW").
- **Media URL Resolution**: All student-side media resolved via a Supabase edge function CDN proxy.
- **Avatar Selection Priority**: Defined priority system for resolving avatar video URLs.
- **Real-Time Chroma Keying**: Employs WebView + HTML5 Canvas for real-time green screen removal with HSL-based algorithm.
- **Video Preloading**: Preloads initial sections' avatar and beat videos with background downloading for subsequent sections.
- **Beat Video Playback**: Uses async cache resolution with disk fallback and remote URL option.
- **Avatar Playback**: Avatar videos use remote HTTPS URLs for WebView; beat videos use cached file URIs via Expo-AV.
- **Avatar Buffering Overlay**: Displays a loading overlay during avatar buffering with safety timeouts.
- **Push Notifications (Local)**: Uses `expo-notifications` for local notifications (motivational, welcome, blog).
- **Push Notifications (Remote — Firebase FCM)**: Uses `@react-native-firebase/app` + `@react-native-firebase/messaging` for FCM tokens. Registers and unregisters tokens with Supabase. Server-side push via Edge Function `send-push-notification`.
- **Auth Persistence**: Returning users skip onboarding via `@onboarding_seen` AsyncStorage flag. OTP verification handles nested and root-level access token response formats. Hardened so a session never ends on its own: every login path that returns an access token must also return a refresh token (Google + OTP now reject a "half-login" that has an access token but no refresh token, instead of silently succeeding); `saveTokens` refuses to overwrite a good stored refresh token with a blank one and writes both tokens in one atomic `multiSet` to shrink the rotation-race window; `refreshSession` keeps the session on transient errors (network/timeout/5xx) and only forces re-login on a definitive `invalid_grant`.
  - **Supabase session settings (2026-06-24, confirmed in dashboard):** "Enforce single session per user" OFF; "Time-box user sessions" = 0 (never); "Inactivity timeout" = 0 (never); "Detect and revoke potentially compromised refresh tokens" turned **OFF** (was ON with a 10s reuse interval — the prime cause of random "logged out after a couple hours / some days" via refresh-token-chain revocation on a rotation race).

## External Dependencies

- **Database**: PostgreSQL
- **Backend Framework**: Express.js
- **UI Libraries**: Shadcn UI, Tailwind CSS
- **Animation Library**: Framer Motion
- **State Management/Data Fetching**: TanStack Query
- **Video Playback**: Expo-AV, Vimeo
- **Text-to-Speech**: Sarvam TTS
- **Backend-as-a-Service**: Supabase
- **Payment Gateway**: Razorpay
- **Remote Push Notifications**: Firebase Cloud Messaging via `@react-native-firebase/app` + `@react-native-firebase/messaging`

## Source Control

- **GitHub Repository**: https://github.com/Prashant-Patole/simple-lecture-mobile-app.git
- **Authentication**: Uses `GITHUB_PERSONAL_ACCESS_TOKEN` secret for push access

## EAS Build Configuration

- **Expo Account**: `prashantuser4s-team` (ACTIVE as of 2026-06-27 — switched from `prashantuser3`, which exhausted its Free-plan monthly Android builds). Auth via a robot access token for this account. NOTE: the `EXPO_TOKEN` Replit secret still holds the OLD `prashantuser3` token — until the user updates it, builds must pass the new token inline via `EXPO_TOKEN=<new>` on the command. Previous account: `prashantuser3` (project ID `528bb502-5ce3-416c-b2db-4b9510b54190`).
- **EAS Project**: `@prashantuser4s-team/edulearn-mobile` (ID: `9c1ebb82-345b-4b63-aecf-bcec57b9be19`) — created 2026-06-27 via `eas init`. Preview APKs under this account use a NEW remote keystore (auto-generated), so its signature differs from all prior `prashantuser3` test builds — uninstall older test builds before installing. Production AAB still uses the LOCAL keystore (`credentialsSource: local`), so Play Store signing identity is unaffected by the account switch.
- **Build Profiles**:
  - `preview` → Android APK, internal distribution (for testing via direct install)
  - `production` → Android AAB (App Bundle), store distribution (for Play Store upload)
- **Android Signing**: Local PKCS12 keystore (`mobile/android_keystore.jks`, gitignored)
  - Key alias: `simple-lecture`, password: stored in `mobile/credentials.json` (gitignored)
  - `credentialsSource: local` in `eas.json` — keystore bundled with archive at build time
  - Keystore also uploaded to EAS account credentials (ID: `0eea72ad-1c49-4f6e-a802-8440c28ece82`)
- **AAB Build Command** (Play Store): `cd mobile && EAS_BUILD_NO_EXPO_GO_WARNING=true EAS_SKIP_AUTO_FINGERPRINT=1 eas build --platform android --profile production --non-interactive --no-wait`
- **APK Build Command** (Testing): `cd mobile && eas build --platform android --profile preview --non-interactive --no-wait`
- **protobufjs EAS pre-install hook**: `mobile/package.json` pins `protobufjs` to a local vendored tarball via an ABSOLUTE `file:` override (a Replit-firewall workaround). That absolute path does not exist on EAS workers, so `npm ci` failed with ENOENT / exit 254. Fixed by `mobile/eas-build-pre-install.js` (wired via the `eas-build-pre-install` npm script) — an EAS-only hook that strips the override and repins the lockfile to the registry before `npm ci`. Local dev keeps the override. Do not delete this file. (See memory `protobufjs-firewall-block.md`.)
- **Latest AAB Build**: ID `11dcd50b-3d40-43d0-a85a-f05f10b10c9a` (status: `FINISHED`, 2026-06-27, SDK 53, versionCode 6 — FIRST production AAB on the `prashantuser4s-team` account, signed with the local keystore that matches the RESET Play upload key activated 2026-06-27 ~08:00 UTC; for Play Store upload) — https://expo.dev/accounts/prashantuser4s-team/projects/edulearn-mobile/builds/11dcd50b-3d40-43d0-a85a-f05f10b10c9a
  - AAB download: https://expo.dev/artifacts/eas/TW694tlaK6WxGVNJIpKBdDK2IIvVY9hhsf9mg0g_a1s.aab
- **Previous AAB Build**: ID `23033cc8-1c3e-489d-8c31-b994c57070b0` (status: `FINISHED`, 2026-06-15, SDK 53, versionCode 4 — fixes Google Play "16 KB memory page sizes" rejection; for Play Store production upload) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/23033cc8-1c3e-489d-8c31-b994c57070b0
  - AAB download: https://expo.dev/artifacts/eas/3m8KkNcVhrbpFHHp0uNQkjEeDaNsnONjxisU1eXesuE.aab
  - **16 KB verified**: all 40 64-bit `.so` files (arm64-v8a + x86_64), incl. Razorpay `standard-core` 1.7.1, have ELF LOAD segments aligned to `0x4000` (16384). Built with NDK 27 / AGP 8.8.2 via SDK 53 defaults.
- **Previous AAB Build**: ID `c6dc87f8-a34a-4ea1-951e-027f7ab3a0c7` (status: `FINISHED`, 2026-06-10, SDK 52, versionCode 3 — rejected by Play for 4 KB-only native libs) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/c6dc87f8-a34a-4ea1-951e-027f7ab3a0c7
  - AAB download: https://expo.dev/artifacts/eas/qygfVCkZRU2aCChnonXZi2.aab
- **Previous AAB Build**: PENDING — versionCode 2 queued (Task #84); build ID `39908b15-137b-4030-9c93-ba40668b7e69` (versionCode 1, 2026-04-22) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/39908b15-137b-4030-9c93-ba40668b7e69
- **Previous AAB Build** (failed — plugin patched wrong file: app/build.gradle instead of root): ID `4e07440f-4dad-4148-8aee-c8e1cd359f0c` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/4e07440f-4dad-4148-8aee-c8e1cd359f0c
- **Previous AAB Build** (failed — plugin patched wrong file: app/build.gradle instead of root): ID `9e43c7e9-d0cf-4287-b7b8-85c7045c7829` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/9e43c7e9-d0cf-4287-b7b8-85c7045c7829
- **Previous AAB Build** (targetSdkVersion 35 in app.json but Play Console still saw 34): ID `3baf8477-38ef-4575-8a65-61356b14a6c5` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/3baf8477-38ef-4575-8a65-61356b14a6c5
- **Previous AAB Build** (failed — expo-store-review v55 mismatch): ID `a2b248c9-11a5-4c56-ab12-8abda9b20294` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/a2b248c9-11a5-4c56-ab12-8abda9b20294
- **Previous AAB Build** (Task #69): ID `7188e330-8d74-4b0a-9b14-73a24d13ffab` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/7188e330-8d74-4b0a-9b14-73a24d13ffab
- **Latest APK Build**: ID `c5d7a8ea-56a6-48a4-8bd1-75be7738d6fe` (2026-06-25, SDK 53, preview profile — first build with the `eas-build-pre-install` protobufjs hook; earlier vc5/vc6 preview APKs had silently errored at `npm ci` due to the absolute protobufjs override) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/c5d7a8ea-56a6-48a4-8bd1-75be7738d6fe
  - NOTE: uses the remote cloud keystore (Build Credentials QQBem7OqIW) — uninstall older test builds before installing.
- **Previous APK Build**: ID `cc88e0c1-73a0-48d6-922d-39e775a7a950` (status: `in queue` at trigger, 2026-06-24, SDK 53 / versionCode 6 — adds "Solutions" tile to the lecture player Quick Actions grid; likely errored at npm ci — see protobufjs hook note above) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/cc88e0c1-73a0-48d6-922d-39e775a7a950
  - NOTE: still uses the remote cloud keystore (Build Credentials QQBem7OqIW) from the vc5 preview build — uninstall older test builds before installing.
- **Previous APK Build**: ID `a62aaf91-ef0c-45aa-98a1-e45ef8d55c60` (status: `in queue` at trigger, 2026-06-24, SDK 53 / versionCode 5 — includes coming-soon Buy Now gating; for direct device testing) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/a62aaf91-ef0c-45aa-98a1-e45ef8d55c60
  - NOTE: local `android_keystore.jks` + `credentials.json` were missing from the env, so the `preview` profile was switched to `credentialsSource: remote` and EAS generated a NEW cloud keystore for this APK. This APK's signature therefore differs from prior preview APKs — uninstall any older test build before installing. Production profile still uses `local`. `EXPO_TOKEN` secret was re-added (prior one was gone).
- **Previous APK Build**: ID `0842cf85-34b0-4c60-8de2-01de82da0ac2` (status: `FINISHED`, 2026-06-15, SDK 53 / versionCode 4 — same code as the vc4 AAB, for direct device testing) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/0842cf85-34b0-4c60-8de2-01de82da0ac2
  - APK download: https://expo.dev/artifacts/eas/VN9sIjJIhY2Zq2z2DMap3AgaLjkUvLujwTY4YZ6EzMo.apk
- **Previous APK Build**: ID `559c276e-ea95-4443-85ea-d36402ca24d2` (2026-06-06, SDK 52 — fixes `npm install` failure; same code as 137b3199 + YouTube landscape fullscreen; for direct device install) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/559c276e-ea95-4443-85ea-d36402ca24d2
  - Root cause of the prior errored builds (137b3199, aa553846, etc.): `mobile/package-lock.json` had 2 `resolved` URLs pointing at Replit's internal proxy `http://package-firewall.replit.local/npm/...` (events, react-native-youtube-iframe) — unreachable from EAS cloud, so `npm install --include=dev` exited 1. Fixed by rewriting both to `https://registry.npmjs.org/...`.
- **Previous APK Build** (errored — npm install firewall URL): ID `137b3199-0fd3-49a6-a13b-ab595ad43d82` (2026-06-06, YouTube player fullscreen now rotates to landscape) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/137b3199-0fd3-49a6-a13b-ab595ad43d82
  - Tapping the in-app YouTube player's fullscreen button now rotates to landscape via `expo-screen-orientation` (`onFullScreenChange`), and always restores portrait on exit/close/unmount/hide (app is locked to portrait in app.json)
  - Triggered with `EAS_NO_VCS=1 ... EAS_SKIP_AUTO_FINGERPRINT=1` — preview builds without the fingerprint-skip flag fast-fail (~90s, errored) on the auto-fingerprint step
- **Previous APK Build**: ID `aa553846-6a84-460f-bb5c-b9888a3cb65f` (2026-06-06, in-app YouTube player rewritten on `react-native-youtube-iframe`; for direct device install) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/aa553846-6a84-460f-bb5c-b9888a3cb65f
  - In-app YouTube playback now uses the `react-native-youtube-iframe` library (replaced the hand-rolled IFrame-API HTML host page that still hit error 152/153 on real APKs)
- **Previous APK Build**: ID `2da72498-286a-4cba-8ab9-16405a10a25f` (status: `FINISHED`, 2026-06-02, includes Task #134 auto chapter test; for direct device install) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/2da72498-286a-4cba-8ab9-16405a10a25f
  - APK download: https://expo.dev/artifacts/eas/6CYgj86qdAei56LyBPjAe6.apk
- **Previous APK Build**: ID `83c85de1-8805-4bd1-9de5-06df35ae465b` (status: `FINISHED`, 2026-06-01, for direct device install) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/83c85de1-8805-4bd1-9de5-06df35ae465b
- **Previous APK Build**: ID `15ae413b-6517-47b0-877e-fc8510adf38a` (status: `NEW`, 2026-04-20, Play ownership verification with native assets plugin) — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/15ae413b-6517-47b0-877e-fc8510adf38a
  - Uses `withAdiRegistration` config plugin to place token at correct `app/src/main/assets/adi-registration.properties` path
  - Previous APK (wrong path — Metro bundled): ID `4c77db1a-6e78-4832-8604-4c1235956866` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/4c77db1a-6e78-4832-8604-4c1235956866
  - Previous APK: ID `d5d8f1c2-13ac-4def-bdff-eccfa58c3f92` — https://expo.dev/accounts/prashantuser3/projects/edulearn-mobile/builds/d5d8f1c2-13ac-4def-bdff-eccfa58c3f92
  - Previous failed build `fb6b9b5d` — fix: added `withFirebaseMessagingFix` plugin (manifest merger conflict)
  - Previous failed build `fc987341` — fix: changed plugin strategy from patch to remove+re-add for `default_notification_color`
- **Archive Size Note**: EAS archives from the WORKSPACE ROOT (root `package.json` makes it a monorepo), so `mobile/.easignore` is never read — the root `/home/runner/workspace/.easignore` is the one that keeps the archive lean (excludes root node_modules/.git/.local/attached_assets/.cache/.config + web dirs + mobile/node_modules + build artifacts; mobile source ≈ 8 MB). Do not delete it or EAS uploads will balloon and stall.
- **Account Verified**: `eas whoami` returns `prashantuser3 (authenticated using EXPO_TOKEN)`
- **FCM Verified**: Test notification sent 2026-04-11 → HTTP 200 ✅

### Play Store Readiness
- **App icon**: 1024×1024 square PNG; versionCode: 4; compileSdkVersion: 35, targetSdkVersion: 35, minSdkVersion: 24 (SDK 53 schema defaults; set via app.json + withTargetSdk plugin)
- **16 KB page size**: resolved by the Expo SDK 52→53 upgrade (NDK 27); verified on the vc4 AAB
- **Privacy Policy**: Hosted at `/privacy-policy` on Express backend
- **In-app review**: `expo-store-review` installed; `maybeRequestReview()` in `mobile/src/utils/inAppReview.ts`
- **Store assets**: `mobile/store-assets/` — play-store-listing.md, screenshot-shot-list.md, feature-graphic.svg/png (1024×500)
- **Manual steps still needed**: Content Rating questionnaire, Data Safety form, upload screenshots, submit for review

### Local Credentials Runbook
`credentialsSource: local` is intentional — EAS CLI cannot generate remote credentials without an interactive TTY.
Before running any non-interactive EAS build, ensure `mobile/android_keystore.jks` and `mobile/credentials.json` are present.
If lost, regenerate with `openssl pkcs12` and recreate credentials.json with the matching alias and password.

**IMPORTANT — Play upload key reset (2026-06-27):** the ORIGINAL Play upload key was lost. An upload-key reset was requested via a Play Console ticket; the NEW upload certificate submitted to Google is byte-for-byte the cert inside the current `mobile/android_keystore.jks` (alias `simple-lecture`, created 2026-06-24, SHA-1 `0C:11:1E:7F:2B:04:23:5B:98:46:6E:B3:1B:AB:29:28:1E:43:64:31`). Google activates the new key at ~08:00 UTC (~2 days after the ticket). **Until activation, uploading an AAB signed with this key is REJECTED; after activation it is accepted.** Production AABs MUST stay `credentialsSource: local` with THIS keystore — do NOT regenerate or let EAS use a remote keystore, or Play upload will fail with a certificate mismatch. (See memory `play-upload-key.md`.)