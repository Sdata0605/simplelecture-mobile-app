// Mobile port of the web app's
// src/components/learning/postLecture/HyperframeAnswerPlayer.tsx. Same
// mechanics: each answer "beat" (segment) is a GSAP-animated HTML page,
// fixed at 1920x1080 and scaled to fit; narration audio is the master clock
// advancing beats on finish; voice toggle, prev/next, caption toggle, and a
// fullscreen/landscape mode all carry over.
//
// Platform adaptations (see the implementation plan for the full reasoning):
//  - `<iframe srcDoc>` -> `react-native-webview`'s `source={{ html }}`, same
//    "fetch the HTML ourselves" workaround (Supabase's locked CSP on Edge
//    Function responses breaks a direct navigation either way).
//  - GSAP timeline control (`contentWindow.__timelines`) -> the same global,
//    reached via `injectJavaScript` instead of direct DOM access.
//  - `<audio onEnded>` -> expo-av's `Audio.Sound` + `didJustFinish`.
//  - Only the current beat + the next one are ever mounted/loaded (WebViews
//    and Sound objects are heavier native resources than DOM iframes/audio
//    elements), not every beat up front like web.
//  - Web's own Fullscreen-API + CSS auto-hide becomes a local layout toggle
//    (this player already lives inside AskAIAssistant's full-screen Modal)
//    plus an expo-screen-orientation landscape lock.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { WebView } from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  resolveHyperframeAssetUrl,
  type AthenaSegment,
  type HyperframeVideoStatus,
} from '../../services/askAssistant/athenaAsk';
import type { PostLectureAnswerPhase } from '../../hooks/usePostLectureAthenaAnswer';
import { askLog, askWarn } from '../../services/askAssistant/askLog';

interface HyperframeAnswerPlayerProps {
  answerId: string | null;
  phase: PostLectureAnswerPhase;
  segments: AthenaSegment[];
  video: HyperframeVideoStatus | null;
  errorMessage: string | null;
  questionText: string;
  onClose: () => void;
}

type Voice = 'female' | 'male';

/** Strip simple inline markup (bold/emphasis spans) Athena's HTML segments
 * use — React Native has no dangerouslySetInnerHTML; a compact mobile
 * caption doesn't need full HTML rendering for a couple of inline tags. */
function stripHtml(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

/** athena-proxy 504s under load often enough that one miss would otherwise
 * leave a beat permanently blank. */
const FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 600;

/** Reports a beat page's own script failures back to RN. These pages are
 * GSAP-driven and usually start with everything at opacity 0, so a failed
 * script reads as "the presentation never came" rather than as an error. */
const FRAME_ERROR_BRIDGE = `
(function () {
  var post = function (msg) {
    try { window.ReactNativeWebView.postMessage(String(msg).slice(0, 300)); } catch (e) {}
  };
  window.onerror = function (message, source, line) {
    post(message + ' @ ' + (source || '?') + ':' + (line || '?'));
  };
  window.addEventListener('unhandledrejection', function (e) {
    post('unhandled rejection: ' + (e && e.reason));
  });
  window.addEventListener('error', function (e) {
    if (e && e.target && e.target.src) post('failed to load ' + e.target.src);
  }, true);
})();
true;
`;

const GSAP_PLAY = `
try {
  var w = window;
  var timelines = w.__timelines;
  var tl = timelines && (timelines.main || Object.values(timelines)[0]);
  if (tl) tl.play(0);
} catch (e) {}
true;
`;
const GSAP_PAUSE = `
try {
  var w = window;
  var timelines = w.__timelines;
  var tl = timelines && (timelines.main || Object.values(timelines)[0]);
  if (tl) tl.pause();
} catch (e) {}
true;
`;
const GSAP_RESUME = `
try {
  var w = window;
  var timelines = w.__timelines;
  var tl = timelines && (timelines.main || Object.values(timelines)[0]);
  if (tl) tl.play();
} catch (e) {}
true;
`;
const GSAP_STOP = `
try {
  var w = window;
  var timelines = w.__timelines;
  var tl = timelines && (timelines.main || Object.values(timelines)[0]);
  if (tl) { tl.pause(); tl.progress(0); }
} catch (e) {}
true;
`;

export function HyperframeAnswerPlayer({
  answerId,
  phase,
  segments,
  video,
  errorMessage,
  questionText,
  onClose,
}: HyperframeAnswerPlayerProps) {
  const webviewRefs = useRef<Record<number, WebView | null>>({});
  const soundRefs = useRef<Record<string, Audio.Sound | null>>({}); // key: `${idx}:${voice}`
  // In-flight createAsync promises, same keys — so the preload pass and a
  // play that races it share one download instead of starting two.
  const soundLoadsRef = useRef<Record<string, Promise<Audio.Sound | null> | null>>({});
  const frameReady = useRef<Record<number, boolean>>({});
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentIdxRef = useRef(0);

  const [voice, setVoice] = useState<Voice>('female');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCaption, setShowCaption] = useState(true);
  const [frameHtml, setFrameHtml] = useState<Record<number, string>>({});
  const [loadingBeat, setLoadingBeat] = useState(false);

  // This player fills a statusBarTranslucent Modal and, in fullscreen, rotates
  // to landscape — so the system bars overlap it on every edge. In landscape
  // the navigation bar lands on whichever side the device rotated towards,
  // which is why the horizontal insets matter too.
  const insets = useSafeAreaInsets();

  const beatCount = video?.html_paths.length ?? 0;
  const hasVideo = !!video && beatCount > 0;
  const currentSegment = segments[currentIdx];

  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  const clearAdvanceTimer = () => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  };

  // -- fetch every beat's HTML eagerly (cheap — just text), but only MOUNT
  // WebViews for the current beat + the next one (see file header).
  //
  // Each beat lands in state on its own rather than waiting for the whole
  // batch, so beat 0 can render while the rest are still downloading, and
  // every fetch retries: athena-proxy 504s under load often enough that a
  // single miss used to leave the stage permanently blank. ----------------
  useEffect(() => {
    if (!video || !answerId || beatCount === 0) return;
    let cancelled = false;
    setFrameHtml({});
    frameReady.current = {};

    const loadBeat = async (path: string, i: number) => {
      for (let attempt = 0; attempt < FETCH_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const res = await fetch(resolveHyperframeAssetUrl(answerId, path));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const html = await res.text();
          if (!html) throw new Error('empty body');
          if (!cancelled) {
            askLog('frame', `beat ${i + 1}/${beatCount} html ready (${html.length} bytes)`);
            setFrameHtml((prev) => ({ ...prev, [i]: html }));
          }
          return;
        } catch (err) {
          if (attempt === FETCH_ATTEMPTS - 1) {
            askWarn('frame', `beat ${i + 1}/${beatCount} html FAILED after ${FETCH_ATTEMPTS} tries: ${String(err)}`);
          } else {
            await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
          }
        }
      }
    };

    video.html_paths.forEach((path, i) => void loadBeat(path, i));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, answerId]);

  const unloadSound = useCallback(async (key: string) => {
    const sound = soundRefs.current[key];
    soundRefs.current[key] = null;
    if (sound) {
      sound.setOnPlaybackStatusUpdate(null);
      try {
        await sound.unloadAsync();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onBeatEnded = useCallback(
    (idx: number) => {
      if (idx !== currentIdxRef.current) return;
      if (idx + 1 < beatCount) {
        setTimeout(() => playBeatRef.current(idx + 1), 400);
      } else {
        setPlaying(false);
      }
    },
    [beatCount],
  );

  /** Create (or reuse) the Sound for one beat. Never autoplays — callers
   * decide, so this is safe to run ahead of time for every beat. */
  const loadSoundForBeat = useCallback(
    async (idx: number, v: Voice) => {
      const path = v === 'female' ? video?.audio_female[idx] : video?.audio_male[idx];
      const key = `${idx}:${v}`;
      if (!path || !answerId) return null;
      const existing = soundRefs.current[key];
      if (existing) return existing;
      const inFlight = soundLoadsRef.current[key];
      if (inFlight) return inFlight;

      const load = (async () => {
        try {
          const { sound } = await Audio.Sound.createAsync(
            { uri: resolveHyperframeAssetUrl(answerId, path) },
            { shouldPlay: false },
          );
          askLog('audio', `beat ${idx + 1} ${v} narration loaded`);
          soundRefs.current[key] = sound;
          sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
            if (!status.isLoaded) return;
            if (status.didJustFinish && currentIdxRef.current === idx) onBeatEnded(idx);
          });
          return sound;
        } catch (err) {
          askWarn('audio', `beat ${idx + 1} ${v} narration FAILED: ${String(err)}`);
          return null;
        } finally {
          soundLoadsRef.current[key] = null;
        }
      })();
      soundLoadsRef.current[key] = load;
      return load;
    },
    [answerId, video, onBeatEnded],
  );

  // Preload every beat's narration up front, in parallel — the web player gets
  // this for free from <audio preload="auto"> on all beats, and without it each
  // beat change paid a fresh download through the proxy before any sound came
  // out. Only the active voice: the other one is loaded on switch.
  useEffect(() => {
    if (!video || !answerId || beatCount === 0) return;
    askLog('audio', `preloading ${beatCount} ${voice} clip(s)`);
    for (let i = 0; i < beatCount; i += 1) void loadSoundForBeat(i, voice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, answerId, voice, beatCount]);

  const playBeatRef = useRef<(idx: number) => void>(() => {});

  const playBeat = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= beatCount) return;
      clearAdvanceTimer();

      // Rewind/stop every other beat, but keep them loaded — they were
      // preloaded on purpose.
      Object.entries(soundRefs.current).forEach(([key, sound]) => {
        if (!sound || Number(key.split(':')[0]) === idx) return;
        void sound.stopAsync().catch(() => {});
      });

      setCurrentIdx(idx);
      currentIdxRef.current = idx;
      if (frameReady.current[idx]) webviewRefs.current[idx]?.injectJavaScript(GSAP_PLAY);
      setPlaying(true);

      const startNarration = (sound: Audio.Sound | null) => {
        if (currentIdxRef.current !== idx) return;
        if (sound) {
          void sound.setPositionAsync(0).catch(() => {});
          void sound.playAsync().catch(() => {});
          return;
        }
        // No narration for this beat — advance on an estimated timer so
        // playback never stalls.
        const seg = segments[idx];
        const secs = Math.max(6, Math.min(20, seg?.t_end && seg?.t_start ? seg.t_end - seg.t_start : 8));
        advanceTimerRef.current = setTimeout(() => onBeatEnded(idx), secs * 1000);
      };

      // Preloaded (the common case): start in this tick, no spinner, no await.
      const ready = soundRefs.current[`${idx}:${voice}`];
      if (ready) {
        askLog('beat', `${idx + 1}/${beatCount} playing (narration preloaded)`);
        startNarration(ready);
        return;
      }
      askWarn('beat', `${idx + 1}/${beatCount} waiting on its narration download`);
      setLoadingBeat(true);
      void loadSoundForBeat(idx, voice).then((sound) => {
        setLoadingBeat(false);
        startNarration(sound);
      });
    },
    [beatCount, voice, segments, loadSoundForBeat, onBeatEnded],
  );
  playBeatRef.current = playBeat;

  // Kick off beat 0 once the video becomes available.
  useEffect(() => {
    if (!video || beatCount === 0) return;
    setCurrentIdx(0);
    const t = setTimeout(() => playBeat(0), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.html_paths.join('|')]);

  const togglePlayPause = () => {
    const key = `${currentIdx}:${voice}`;
    const sound = soundRefs.current[key];
    if (playing) {
      webviewRefs.current[currentIdx]?.injectJavaScript(GSAP_PAUSE);
      void sound?.pauseAsync();
      setPlaying(false);
    } else {
      webviewRefs.current[currentIdx]?.injectJavaScript(GSAP_RESUME);
      void sound?.playAsync();
      setPlaying(true);
    }
  };

  const switchVoice = useCallback(
    async (next: Voice) => {
      if (next === voice) return;
      const prevKey = `${currentIdx}:${voice}`;
      const prevSound = soundRefs.current[prevKey];
      let positionMs = 0;
      if (prevSound) {
        const status = await prevSound.getStatusAsync();
        if (status.isLoaded) positionMs = status.positionMillis;
        await prevSound.pauseAsync();
      }
      setVoice(next);
      // The current beat first so the swap is audible straight away; the
      // preload effect then picks up the rest for the new voice.
      const nextSound = await loadSoundForBeat(currentIdx, next);
      if (nextSound) {
        await nextSound.setPositionAsync(positionMs);
        if (playing) await nextSound.playAsync();
      }
      // Drop the voice we left so only one voice's clips stay resident.
      Object.keys(soundRefs.current)
        .filter((key) => key.endsWith(`:${voice}`))
        .forEach((key) => void unloadSound(key));
    },
    [voice, currentIdx, playing, loadSoundForBeat, unloadSound],
  );

  const goToBeat = (idx: number) => {
    if (idx < 0 || idx >= beatCount) return;
    webviewRefs.current[currentIdx]?.injectJavaScript(GSAP_STOP);
    playBeat(idx);
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    } else {
      setIsFullscreen(false);
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    }
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearAdvanceTimer();
      Object.keys(soundRefs.current).forEach((key) => void unloadSound(key));
      if (isFullscreen) void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const captionText = stripHtml(currentSegment?.html) || currentSegment?.plain || '';

  return (
    <View style={[styles.player, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.headerClose}>
          <Ionicons name="arrow-back" size={18} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {questionText || 'Your question'}
        </Text>
        {hasVideo && (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>HyperFrame</Text>
          </View>
        )}
      </View>

      <View style={styles.stage}>
        {(phase === 'asking' || phase === 'streaming') && segments.length === 0 && (
          <View style={styles.thinkingRow}>
            <Ionicons name="sparkles" size={16} color="#A78BFA" />
            <Text style={styles.thinkingText}>Thinking…</Text>
          </View>
        )}

        {phase === 'out_of_scope' && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{errorMessage || "This doesn't seem to be part of this lecture."}</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{errorMessage || 'Something went wrong answering that.'}</Text>
          </View>
        )}

        {!hasVideo && segments.length > 0 && phase !== 'out_of_scope' && phase !== 'error' && (
          <View style={styles.textCards}>
            {segments.map((seg, i) => (
              <View key={i} style={styles.segCard}>
                {seg.type && seg.type !== 'concept' && <Text style={styles.segCardType}>{seg.type}</Text>}
                <Text style={styles.segCardText}>{stripHtml(seg.html) || seg.plain || ''}</Text>
              </View>
            ))}
            {phase === 'awaiting_video' && (
              <View style={styles.thinkingRow}>
                <Ionicons name="sparkles" size={14} color="#A78BFA" />
                <Text style={styles.thinkingText}>Rendering video…</Text>
              </View>
            )}
          </View>
        )}

        {hasVideo && answerId && (
          <View style={styles.videoFrameBox}>
            <View style={styles.videoWrapper}>
              <Text style={styles.beatCounter}>
                {currentIdx + 1} / {beatCount}
              </Text>
              {[currentIdx, currentIdx + 1]
                .filter((i) => i >= 0 && i < beatCount && frameHtml[i])
                .map((i) => (
                  <View key={i} style={[StyleSheet.absoluteFill, { opacity: i === currentIdx ? 1 : 0 }]} pointerEvents={i === currentIdx ? 'auto' : 'none'}>
                    <WebView
                      ref={(el) => {
                        webviewRefs.current[i] = el;
                      }}
                      originWhitelist={['*']}
                      source={{ html: frameHtml[i] }}
                      style={styles.webview}
                      scrollEnabled={false}
                      javaScriptEnabled
                      domStorageEnabled
                      onShouldStartLoadWithRequest={(request) =>
                        request.url === 'about:blank' || request.url.startsWith('data:')
                      }
                      // A beat that renders but stays blank (a script the page
                      // needs failing to load, a GSAP error) is otherwise
                      // invisible from the outside — surface it in the log.
                      injectedJavaScriptBeforeContentLoaded={FRAME_ERROR_BRIDGE}
                      onMessage={(e) => {
                        askWarn('frame', `beat ${i + 1} page error: ${e.nativeEvent.data}`);
                      }}
                      onError={({ nativeEvent }) =>
                        askWarn('frame', `beat ${i + 1} load error: ${nativeEvent.description}`)
                      }
                      onHttpError={({ nativeEvent }) =>
                        askWarn('frame', `beat ${i + 1} HTTP ${nativeEvent.statusCode}`)
                      }
                      onLoadEnd={() => {
                        frameReady.current[i] = true;
                        if (i === currentIdxRef.current) {
                          webviewRefs.current[i]?.injectJavaScript(GSAP_PLAY);
                        } else {
                          webviewRefs.current[i]?.injectJavaScript(GSAP_STOP);
                        }
                      }}
                    />
                  </View>
                ))}
              {loadingBeat && (
                <View style={styles.loadingOverlay} pointerEvents="none">
                  <ActivityIndicator color="#fff" />
                </View>
              )}
            </View>
            {showCaption && captionText.length > 0 && (
              <View style={styles.textPanel}>
                {currentSegment?.title && <Text style={styles.textPanelTitle}>{currentSegment.title}</Text>}
                <Text style={styles.textPanelCaption}>{captionText}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {hasVideo && (
        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Pressable
            onPress={() => goToBeat(currentIdx - 1)}
            disabled={currentIdx === 0}
            style={[styles.btn, currentIdx === 0 && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Previous"
          >
            <Ionicons name="chevron-back" size={18} color={currentIdx === 0 ? '#6b7280' : '#fff'} />
          </Pressable>

          <View style={styles.controlsCenter}>
            <View style={styles.voiceToggle}>
              <Pressable onPress={() => void switchVoice('female')} style={[styles.voiceBtn, voice === 'female' && styles.voiceBtnActive]}>
                <Text style={styles.voiceBtnText}>♀</Text>
              </Pressable>
              <Pressable onPress={() => void switchVoice('male')} style={[styles.voiceBtn, voice === 'male' && styles.voiceBtnActive]}>
                <Text style={styles.voiceBtnText}>♂</Text>
              </Pressable>
            </View>
            <Pressable onPress={togglePlayPause} style={[styles.btn, styles.btnPrimary]} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
              <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#fff" />
            </Pressable>
            <View style={styles.dots}>
              {video!.html_paths.map((_, i) => (
                <Pressable key={i} onPress={() => goToBeat(i)} style={[styles.dot, i === currentIdx && styles.dotActive]} />
              ))}
            </View>
            <Pressable
              onPress={() => setShowCaption((v) => !v)}
              style={[styles.btn, showCaption && styles.btnActive]}
              accessibilityRole="button"
              accessibilityLabel={showCaption ? 'Hide narration text' : 'Show narration text'}
            >
              <Ionicons name={showCaption ? 'eye-outline' : 'eye-off-outline'} size={16} color="#fff" />
            </Pressable>
            <Pressable onPress={toggleFullscreen} style={styles.btn} accessibilityRole="button" accessibilityLabel="Fullscreen">
              <Ionicons name={isFullscreen ? 'contract-outline' : 'expand-outline'} size={16} color="#fff" />
            </Pressable>
          </View>

          <Pressable
            onPress={() => goToBeat(currentIdx + 1)}
            disabled={currentIdx >= beatCount - 1}
            style={[styles.btn, currentIdx >= beatCount - 1 && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Next"
          >
            <Ionicons name="chevron-forward" size={18} color={currentIdx >= beatCount - 1 ? '#6b7280' : '#fff'} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  player: {
    flex: 1,
    backgroundColor: '#0B0B14',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  headerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(167,139,250,0.25)',
  },
  headerBadgeText: {
    color: '#C4B5FD',
    fontSize: 10,
    fontWeight: '700',
  },
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  thinkingText: {
    color: '#D1D5DB',
    fontSize: 13,
  },
  notice: {
    padding: 16,
  },
  noticeText: {
    color: '#D1D5DB',
    fontSize: 14,
    textAlign: 'center',
  },
  textCards: {
    width: '100%',
    gap: 10,
  },
  segCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
  },
  segCardType: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  segCardText: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 20,
  },
  videoFrameBox: {
    width: '100%',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 12,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  beatCounter: {
    position: 'absolute',
    top: 8,
    right: 10,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    zIndex: 2,
  },
  textPanel: {
    marginTop: 10,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 12,
  },
  textPanelTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  textPanelCaption: {
    color: '#D1D5DB',
    fontSize: 13,
    lineHeight: 19,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  controlsCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  btnPrimary: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#7C3AED',
  },
  btnActive: {
    backgroundColor: 'rgba(167,139,250,0.35)',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  voiceToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 2,
  },
  voiceBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnActive: {
    backgroundColor: '#7C3AED',
  },
  voiceBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  dotActive: {
    backgroundColor: '#A78BFA',
  },
});
