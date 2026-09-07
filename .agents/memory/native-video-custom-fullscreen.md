---
name: Native video custom fullscreen
description: App UI cannot be layered over expo-av native fullscreen; use one app-controlled video surface for custom fullscreen controls.
---

When fullscreen must include app-owned UI such as title, language selection, notes, or custom controls, do not use the native `expo-av` fullscreen surface. Rotate and resize the single in-app video surface instead.

**Why:** Native fullscreen owns its rendering surface, so React Native headers and panels cannot appear over it. Mounting a second player to work around that can also crash Android through decoder/surface reuse.

**How to apply:** Keep exactly one live video component, switch its container between portrait and landscape, preserve position/play state across source changes, and render the full overlay in the app-controlled fullscreen branch.