---
name: YouTube embed in react-native-webview
description: Why YouTube IFrame error 152/153 happens in the in-app player and the approach that actually plays.
---

# YouTube embed in react-native-webview (Live Classes player)

## The reliable solution: use the library, not a hand-rolled host page
Use **`react-native-youtube-iframe`** (videoId only, `play` + `mute` props,
`onReady`/`onError`). It is pure JS, peer-deps the already-installed
`react-native-webview`, and needs no native/build config. It handles the Android
WebView embedding setup correctly out of the box.

**Why:** A hand-rolled HTML host page (loading `youtube.com/iframe_api` inside
`source={{ html, baseUrl }}` with a non-youtube `baseUrl`/`origin`) seemed correct
and passed review, but **still failed with 152/153 on a real installed APK** (not
just Expo Go) for videos that were confirmed embeddable (`playableInEmbed:true`,
oEmbed 200). The subtle WebView config that makes embedding work is exactly what
the library gets right and the hand-rolled page got wrong. Don't re-roll it.

## Pre-flight diagnosis before touching the player
When an embed "fails", first rule out the non-player causes:
- Confirm the video is embeddable: oEmbed `https://www.youtube.com/oembed?url=...&format=json`
  returns 200 and `playableInEmbed:true`. If true, embedding IS allowed — the bug is
  player/origin config, not the video.
- Confirm only the 11-char **video ID** reaches the player (not a full URL) — logs.
- Confirm no proxy rewrites the embed (the Supabase/workers.dev proxy here only
  fetches class-schedule data; it never touches playback).

## The old hand-rolled pattern (kept for context — it was NOT enough)
Hosting the IFrame API in an HTML doc with a real-looking non-youtube `baseUrl`
+ matching `origin` playerVar restores an embedding referrer on the web, but on a
real Android APK it still hit 152/153. Superseded by the library above.

## Error-code → origin mapping (learned over several failed attempts)
- no embedding origin at all (direct top-level `/embed` nav) → **153**
- origin / `widget_referrer` = `youtube.com` ("youtube embedding youtube" abuse) → **152** (and some 153 variants)
- desktop `userAgent` override → stricter desktop embed → **153**
- real **non-youtube** https origin hosting the IFrame API → plays.

## How to apply
- Never set the WebView `userAgent` to a desktop UA, and never use a `youtube.com`
  origin/baseUrl/`widget_referrer`.
- `mute: 1` is required (mobile blocks unmuted autoplay); call `playVideo()` in
  `onReady`; user unmutes via the player's own controls.
- Use the IFrame API `onError` codes for the fallback, NOT DOM scraping. Codes
  101/150 = embedding disabled by owner (can never play in any embed — but if the
  web app plays it, embedding is allowed, so the failure is an origin problem, not
  the video). 100 = not found/private. 2/5 = param/HTML5 errors.
- Add a ready-timeout (~15s) that flips to the "Watch on YouTube" fallback, so a
  stalled API init never leaves a blank/spinning player.
- `onHttpError` is a footgun with `source.html`: YouTube loads many sub-resources
  (ads/pixels) that can return ≥400 and would falsely trigger the fallback. Rely
  on the IFrame API `onError` + the WebView's `onError` (main-frame) instead.
- If a clean embed still fails only in **Expo Go**, test the EAS APK — can be an
  Expo Go WebView quirk rather than the embed config.
- Domain-restricted videos (rare, enterprise) only embed on whitelisted domains;
  if those fail, the baseUrl must match the exact web domain where it works.
