/**
 * Slide-presentation player for a Doubts answer's `slide_preview`.
 *
 * KEY FIXES (over the original):
 * - Segmented progress bar: one tappable segment per slide — tap any segment
 *   to jump straight to that slide (plays if already playing, browses if not).
 * - Prev/next are now fully async so the generation bump always completes
 *   before the next slide starts loading — no double-audio window.
 * - Controls wrapped in a plain View; TouchableOpacity uses activeOpacity so
 *   they receive taps reliably even when the card is inside a ScrollView.
 * - Generation-ref teardown convention preserved throughout.
 */
import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { DoubtSlidePreview } from '../../utils/doubtThreads';

const NO_AUDIO_SLIDE_SECONDS = 6;

const colors = {
  primary: '#2BBD6E',
  primaryLight: '#DCFCE7',
  primaryMid: '#86EFAC',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  track: '#E5E7EB',
  card: '#FFFFFF',
};

interface SlidePreviewPlayerProps {
  preview: DoubtSlidePreview;
}

const SlidePreviewPlayer = memo(({ preview }: SlidePreviewPlayerProps) => {
  const slides = preview.presentation_slides;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);

  const generationRef = useRef(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref so async callbacks always read the latest index without
  // creating stale-closure bugs.
  const indexRef = useRef(0);
  indexRef.current = index;
  const playingRef = useRef(false);
  playingRef.current = playing;

  // ─── duration helpers ────────────────────────────────────────────────────

  const audioByIndex = useMemo(() => {
    const map = new Map<number, { audioUrl: string; duration?: number }>();
    for (const u of preview.slide_audio_urls?.urls ?? []) {
      map.set(u.slideIndex, { audioUrl: u.audioUrl, duration: u.duration });
    }
    return map;
  }, [preview]);

  const slideDurations = useMemo(
    () =>
      slides.map((_, i) => {
        const d = audioByIndex.get(i)?.duration;
        return d && d > 0 ? d : NO_AUDIO_SLIDE_SECONDS;
      }),
    [slides, audioByIndex]
  );

  const totalSeconds = useMemo(() => {
    const summed = slideDurations.reduce((a, b) => a + b, 0);
    return preview.total_duration_seconds && preview.total_duration_seconds > 0
      ? preview.total_duration_seconds
      : summed;
  }, [preview, slideDurations]);

  const elapsedBefore = useCallback(
    (i: number) => slideDurations.slice(0, i).reduce((a, b) => a + b, 0),
    [slideDurations]
  );

  // ─── audio teardown ───────────────────────────────────────────────────────

  /** Synchronously bumps the generation (invalidating any in-flight async ops)
   *  then fires-and-forgets the audio unload. Returns the NEW generation so
   *  callers can capture it before starting the next load. */
  const stopEverything = useCallback((): number => {
    const newGen = generationRef.current + 1;
    generationRef.current = newGen;

    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      sound.setOnPlaybackStatusUpdate(null);
      sound.unloadAsync().catch(() => {});
    }
    return newGen;
  }, []);

  useEffect(() => {
    return () => { stopEverything(); };
  }, [stopEverything]);

  // ─── playback ─────────────────────────────────────────────────────────────

  const playSlide = useCallback(async (i: number) => {
    const myGen = stopEverything();          // sync bump; new generation captured
    setIndex(i);
    setPositionSec(0);
    setPlaying(true);

    const narration = audioByIndex.get(i);
    if (!narration) {
      fallbackTimerRef.current = setTimeout(() => {
        if (generationRef.current !== myGen) return;
        // advance or stop at end
        const next = i + 1;
        if (next < slides.length) {
          playSlide(next);
        } else {
          stopEverything();
          setPlaying(false);
        }
      }, NO_AUDIO_SLIDE_SECONDS * 1000);
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      if (generationRef.current !== myGen) return;

      const { sound } = await Audio.Sound.createAsync(
        { uri: narration.audioUrl },
        { shouldPlay: true }
      );
      if (generationRef.current !== myGen) {
        sound.unloadAsync().catch(() => {});
        return;
      }

      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (generationRef.current !== myGen) return;
        if (!s.isLoaded) return;
        if (s.didJustFinish) {
          const next = i + 1;
          if (next < slides.length) {
            playSlide(next);
          } else {
            stopEverything();
            setPlaying(false);
            setPositionSec(slideDurations[i] ?? 0);
          }
        } else {
          setPositionSec((s.positionMillis || 0) / 1000);
        }
      });
    } catch {
      if (generationRef.current !== myGen) return;
      fallbackTimerRef.current = setTimeout(() => {
        if (generationRef.current !== myGen) return;
        const next = i + 1;
        if (next < slides.length) {
          playSlide(next);
        } else {
          stopEverything();
          setPlaying(false);
        }
      }, NO_AUDIO_SLIDE_SECONDS * 1000);
    }
  }, [audioByIndex, slides.length, slideDurations, stopEverything]);

  // ─── control handlers (all fully async) ──────────────────────────────────

  const handlePlayPause = useCallback(() => {
    if (playingRef.current) {
      stopEverything();
      setPlaying(false);
      setPositionSec(0);
    } else {
      playSlide(indexRef.current);
    }
  }, [playSlide, stopEverything]);

  const handlePrev = useCallback(() => {
    const i = Math.max(0, indexRef.current - 1);
    if (playingRef.current) {
      playSlide(i);
    } else {
      stopEverything();
      setIndex(i);
      setPositionSec(0);
    }
  }, [playSlide, stopEverything]);

  const handleNext = useCallback(() => {
    const i = Math.min(slides.length - 1, indexRef.current + 1);
    if (playingRef.current) {
      playSlide(i);
    } else {
      stopEverything();
      setIndex(i);
      setPositionSec(0);
    }
  }, [playSlide, slides.length, stopEverything]);

  /** Jump to a specific slide by tapping its segment. */
  const handleSegmentPress = useCallback((i: number) => {
    if (playingRef.current) {
      playSlide(i);
    } else {
      stopEverything();
      setIndex(i);
      setPositionSec(0);
    }
  }, [playSlide, stopEverything]);

  // ─── derived render values ────────────────────────────────────────────────

  const slide = slides[index];
  const imageUrl = preview.image_urls?.[String(index)]?.url ?? slide?.infographicUrl;

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.card}>

      {/* Header */}
      <View style={styles.headerRow}>
        <Ionicons name="easel-outline" size={14} color={colors.primary} />
        <Text style={styles.headerText}>Watch this explained</Text>
        <Text style={styles.slideCount}>{index + 1}/{slides.length}</Text>
      </View>

      {/* Slide content */}
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={styles.slideTextBlock}>
          {!!slide?.title && <Text style={styles.slideTitle}>{slide.title}</Text>}
          {!!slide?.content && <Text style={styles.slideContent}>{slide.content}</Text>}
          {(slide?.bullet_points ?? []).map((b, bi) => (
            <View key={bi} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Segmented tappable progress bar ── */}
      <View style={styles.segmentedBar}>
        {slides.map((_, i) => {
          const segWidth = totalSeconds > 0
            ? `${(slideDurations[i] / totalSeconds) * 100}%`
            : `${100 / slides.length}%`;

          // Fill state for this segment
          let fillStyle;
          if (i < index) {
            // already passed
            fillStyle = styles.segFillDone;
          } else if (i === index) {
            // active — fill proportionally to position within slide
            const slideDur = slideDurations[i];
            const fillPct = slideDur > 0
              ? Math.min(1, positionSec / slideDur) * 100
              : (playing ? 100 : 0);
            fillStyle = [styles.segFillActive, { width: `${fillPct}%` as any }];
          } else {
            fillStyle = null;
          }

          const isFirst = i === 0;
          const isLast = i === slides.length - 1;

          return (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onPress={() => handleSegmentPress(i)}
              style={[
                styles.segment,
                { width: segWidth as any },
                isFirst && styles.segFirst,
                isLast && styles.segLast,
                i === index && styles.segActive,
              ]}
            >
              {/* filled portion */}
              {i < index && (
                <View style={[StyleSheet.absoluteFill, styles.segFillDone]} />
              )}
              {i === index && (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.segFillActive,
                    {
                      width: `${
                        slideDurations[i] > 0
                          ? Math.min(100, (positionSec / slideDurations[i]) * 100)
                          : playing ? 100 : 0
                      }%`,
                    },
                  ]}
                />
              )}
              {/* slide number dot — only on wider screens */}
              {slides.length <= 8 && (
                <Text style={styles.segLabel}>{i + 1}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Controls */}
      <View style={styles.controlsRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handlePrev}
          disabled={index === 0}
          style={[styles.controlButton, index === 0 && styles.controlDisabled]}
          testID="button-slide-prev"
        >
          <Ionicons name="play-skip-back" size={18} color={colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handlePlayPause}
          style={styles.playButton}
          testID="button-slide-play"
        >
          <Ionicons name={playing ? 'stop' : 'play'} size={20} color="#FFFFFF" />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={handleNext}
          disabled={index === slides.length - 1}
          style={[styles.controlButton, index === slides.length - 1 && styles.controlDisabled]}
          testID="button-slide-next"
        >
          <Ionicons name="play-skip-forward" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.card,
    padding: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },
  headerText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.text,
  },
  slideCount: {
    fontSize: 11.5,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
  },
  slideTextBlock: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  slideTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  slideContent: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  bulletDot: {
    fontSize: 13,
    color: colors.primary,
    marginRight: 6,
    fontWeight: '700',
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.text,
  },

  // ── Segmented bar ──
  segmentedBar: {
    flexDirection: 'row',
    height: 28,           // tall enough to tap comfortably
    marginTop: 10,
    marginBottom: 2,
    gap: 2,
    alignItems: 'stretch',
  },
  segment: {
    flex: 1,              // overridden by explicit width below
    height: '100%',
    backgroundColor: colors.track,
    borderRadius: 3,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segFirst: {
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  segLast: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  segActive: {
    // slightly raised for the current slide
    borderColor: colors.primary,
    borderWidth: 1,
  },
  segFillDone: {
    backgroundColor: colors.primaryMid,
  },
  segFillActive: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: colors.primary,
  },
  segLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    zIndex: 1,
  },

  // ── Controls ──
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginTop: 8,
  },
  controlButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: {
    opacity: 0.35,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SlidePreviewPlayer;
