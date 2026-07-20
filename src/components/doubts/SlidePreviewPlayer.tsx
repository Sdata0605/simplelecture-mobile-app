/**
 * Mini slide-presentation player for a Doubts answer's `slide_preview`.
 *
 * One image per slide + optional narration audio. Auto-advances when a
 * slide's audio ends; slides without audio advance on a 6s fallback timer.
 * The progress bar reflects (elapsed before current slide + current audio
 * position) / total duration.
 *
 * Teardown follows the app's generation-ref convention: every play/stop/
 * slide-change bumps the generation, and every async completion checks it
 * before touching state, so a stale audio load can never resurrect playback.
 */
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { DoubtSlidePreview } from '../../utils/doubtThreads';

const NO_AUDIO_SLIDE_SECONDS = 6;

const colors = {
  primary: '#2BBD6E',
  primaryLight: '#DCFCE7',
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
  const indexRef = useRef(0);
  indexRef.current = index;

  /** slideIndex → narration entry. */
  const audioByIndex = useMemo(() => {
    const map = new Map<number, { audioUrl: string; duration?: number }>();
    for (const u of preview.slide_audio_urls?.urls ?? []) {
      map.set(u.slideIndex, { audioUrl: u.audioUrl, duration: u.duration });
    }
    return map;
  }, [preview]);

  /** Per-slide durations (seconds) for the overall progress computation. */
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

  const elapsedBefore = (i: number) => slideDurations.slice(0, i).reduce((a, b) => a + b, 0);

  const stopEverything = async () => {
    generationRef.current += 1;
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
  };

  // Full teardown on unmount (e.g. new question strips this block).
  useEffect(() => {
    return () => {
      stopEverything();
    };
  }, []);

  const advanceFrom = (i: number, myGeneration: number) => {
    if (generationRef.current !== myGeneration) return;
    const next = i + 1;
    if (next < slides.length) {
      playSlide(next);
    } else {
      // End of deck: stop and rest on the last slide.
      stopEverything();
      setPlaying(false);
      setPositionSec(slideDurations[i] ?? 0);
    }
  };

  const playSlide = async (i: number) => {
    await stopEverything();
    const myGeneration = generationRef.current;
    setIndex(i);
    setPositionSec(0);
    setPlaying(true);

    const narration = audioByIndex.get(i);
    if (!narration) {
      // No audio for this slide — hold it for the fallback interval.
      fallbackTimerRef.current = setTimeout(
        () => advanceFrom(i, myGeneration),
        NO_AUDIO_SLIDE_SECONDS * 1000
      );
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      if (generationRef.current !== myGeneration) return;
      const { sound } = await Audio.Sound.createAsync({ uri: narration.audioUrl }, { shouldPlay: true });
      if (generationRef.current !== myGeneration) {
        sound.unloadAsync().catch(() => {});
        return;
      }
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s) => {
        if (generationRef.current !== myGeneration) return;
        if (!s.isLoaded) return;
        if (s.didJustFinish) {
          advanceFrom(i, myGeneration);
        } else {
          setPositionSec((s.positionMillis || 0) / 1000);
        }
      });
    } catch {
      // Audio failed to load — degrade to the timed fallback.
      if (generationRef.current !== myGeneration) return;
      fallbackTimerRef.current = setTimeout(
        () => advanceFrom(i, myGeneration),
        NO_AUDIO_SLIDE_SECONDS * 1000
      );
    }
  };

  const handlePlayPause = () => {
    if (playing) {
      stopEverything();
      setPlaying(false);
      setPositionSec(0);
    } else {
      playSlide(indexRef.current);
    }
  };

  const handlePrev = () => {
    const i = Math.max(0, indexRef.current - 1);
    if (playing) playSlide(i);
    else {
      stopEverything();
      setIndex(i);
      setPositionSec(0);
    }
  };

  const handleNext = () => {
    const i = Math.min(slides.length - 1, indexRef.current + 1);
    if (playing) playSlide(i);
    else {
      stopEverything();
      setIndex(i);
      setPositionSec(0);
    }
  };

  const slide = slides[index];
  const imageUrl = preview.image_urls?.[String(index)]?.url ?? slide?.infographicUrl;
  const progress =
    totalSeconds > 0 ? Math.min(1, (elapsedBefore(index) + positionSec) / totalSeconds) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="easel-outline" size={14} color={colors.primary} />
        <Text style={styles.headerText}>Watch this explained</Text>
        <Text style={styles.slideCount}>
          {index + 1}/{slides.length}
        </Text>
      </View>

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

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          onPress={handlePrev}
          disabled={index === 0}
          style={[styles.controlButton, index === 0 && styles.controlDisabled]}
          testID="button-slide-prev"
        >
          <Ionicons name="play-skip-back" size={16} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handlePlayPause} style={styles.playButton} testID="button-slide-play">
          <Ionicons name={playing ? 'stop' : 'play'} size={18} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleNext}
          disabled={index === slides.length - 1}
          style={[styles.controlButton, index === slides.length - 1 && styles.controlDisabled]}
          testID="button-slide-next"
        >
          <Ionicons name="play-skip-forward" size={16} color={colors.primary} />
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
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.track,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 8,
  },
  controlButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlDisabled: {
    opacity: 0.4,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SlidePreviewPlayer;
