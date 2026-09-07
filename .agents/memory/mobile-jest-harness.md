---
name: Mobile Jest harness for supabase.ts
description: How to unit-test the giant mobile/src/services/supabase.ts auth module under Jest without the full RN runtime.
---

# Testing the mobile auth module under Jest

The mobile app had no test harness. To test the real auth logic in the ~9.4k-line
`mobile/src/services/supabase.ts` singleton without pulling in React Native:

- The module's ONLY top-level import is `@react-native-async-storage/async-storage`,
  and `SupabaseService` has no constructor side-effects (only field initializers from
  inline constants). So you can import the real module under a plain `testEnvironment: node`.
- Transform with `babel-jest` + `babel-preset-expo` (both already present); pass
  `{ babelrc:false, configFile:false }` so no global `babel.config.js` is needed
  (keeps Metro/EAS untouched). Config lives in `mobile/jest.config.js`, scoped to mobile.
- Map AsyncStorage to an in-memory mock via `moduleNameMapper`
  (`mobile/src/services/__tests__/asyncStorageMock.ts`); the test imports the same file
  for `__setStore/__getStore/__reset/__failNextMultiSet` helpers (same module instance).

**Why:** `npx tsc --noEmit` times out (>120s) on this RN project, so Jest is the only
practical automated check for auth logic.

**The fetch-interceptor gotcha (load-bearing):** at import time `supabase.ts` runs
`installAuthRetryInterceptor()`, which wraps `global.fetch` and captures the *current*
`global.fetch` as its "original". If you set `global.fetch = jest.fn()` AFTER import you
destroy the interceptor. Fix: in a `setupFiles` file (runs BEFORE the module import),
install a stable delegator — `global.fetch = (i,init)=>global.__fetchImpl(i,init)` — then
each test swaps `global.__fetchImpl`. The interceptor binds to the delegator, so the
swappable impl survives and the 401-retry path is still testable.

**How to apply:** run `cd mobile && npx jest authSession` (or `npm test`). Reset singleton
state in `beforeEach` (`proactiveCooldownUntil=0`, `refreshPromise=null`, clear the
session-invalid handler) — it persists across tests. Build JWTs with
`Buffer.from(JSON.stringify({exp})).toString('base64url')`; the module's custom base64
decoder accepts base64url.
