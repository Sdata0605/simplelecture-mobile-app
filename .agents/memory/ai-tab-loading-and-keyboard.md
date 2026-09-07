---
name: AI tab loading flag & Android keyboard avoidance
description: Two recurring gotchas on TopicDetailsScreen's AI tab — the aiLoading deadlock and Android KeyboardAvoidingView double-resize.
---

## aiLoading must always be released
`aiLoading` gates the AI tab loading screen AND blocks suggestion taps
(both `handlePickAiSuggestion` and `handleSelectSuggestion` bail when it's
true). If any async step (quota calls, sound `unloadAsync`, the AI request,
audio preload) throws after `setAiLoading(true)`, the flag sticks true and
every future tap silently does nothing — the classic "tap registers but no
presentation" report.

**Why:** state setters are async; an unhandled throw skips the trailing
`setAiLoading(false)`.

**How to apply:** any handler that sets `aiLoading(true)` MUST release it in a
`finally`. `handleSelectSuggestion` and `handleAskAI` are both wrapped in
try/catch/finally for this reason. Set the flag early (on tap) so the loading
screen gives instant feedback, and surface guard early-returns (missing
topic/subjectId) as visible errors, never silent returns.

## KeyboardAvoidingView "input drifts downward on repeated taps"
The REAL root cause of the AI-tab drift was structural, not the KAV behavior
prop: the tab's `KeyboardAvoidingView` (which holds its own inner ScrollView +
a pinned input bar) was rendered INSIDE the outer `<ScrollView style=content>`
in renderContent. A KAV nested in a parent ScrollView gets unbounded height, so
its `flex:1` and onLayout frame measurement are meaningless and each keyboard
show/hide cycle compounds the offset — the input creeps down on every tap.

**Why:** a ScrollView lays children out at their natural (unbounded) height
along the scroll axis even when the ScrollView itself is `flex:1`, so a child
KAV can never measure a real viewport height.

**How to apply:** never nest a KeyboardAvoidingView inside a ScrollView. Render
the tab in a bounded `flex:1` View (in TopicDetailsScreen, the `ai` tab joins
the `doubts`/`reels` branch that uses a plain View, not the outer ScrollView)
and give the KAV `flex:1` so it fills it. Then Android → `behavior={undefined}`
(native resize), iOS → `behavior="padding"`, with
`android.softwareKeyboardLayoutMode: "resize"` in app.json. The behavior-prop
change alone (earlier attempt) only masked the symptom.

## Keyboard stops resizing after returning from a presentation
After the AI presentation's fullscreen toggle (`isPresentationFullscreen`), the
chat input stopped rising with the keyboard. Cause: the orientation effect's
close branch did `lockAsync(PORTRAIT_UP)` then `unlockAsync()` after 300ms. The
trailing unlock leaves the Android activity in sensor/UNSPECIFIED orientation,
which resets the window's soft-input mode, so the native resize the KAV depends
on stops happening (the chat KAV remounts fresh on return, so it's NOT a JS/view
issue — it's activity-level).

**Why:** changing `setRequestedOrientation` to unspecified re-evaluates window
flags incl. soft-input mode; the manifest default isn't guaranteed to be resize
(esp. in Expo Go).

**How to apply:** the app is portrait-only (app.json `orientation: "portrait"`),
so do NOT unlock after a presentation — lock to `PORTRAIT_UP` and keep it locked.
Only unlock inside the fullscreen branch (where rotation is wanted). Rotation
still works during presentations; the keyboard stays healthy afterward.

## Rendering math/chemistry on the AI tab
AI suggestion rows + presentation content/keyPoints carry LaTeX (`$\Delta$`,
`\ce{...}`, `\frac`, sub/superscripts). Render them with `<MathText>` (KaTeX +
mhchem WebView) gated on `containsLatex(...)` so plain strings keep the cheap
`<Text numberOfLines>` clamp. A native `TextInput` CANNOT typeset math — when a
selected question is pushed into the chat field, run `sanitizeLatexForInput()`
(LaTeX→Unicode + strip `$`/`\ce`/`\text`/`\frac`/`\sqrt`/`\left|\right`). Order
matters: convert arrow tokens (`\rightarrow`) BEFORE stripping `\left|\right`, or
"\rightarrow" loses its "\right" and becomes "arrow".
