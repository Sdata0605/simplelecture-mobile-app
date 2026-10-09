// Plays the pre-generated assistant voice clips (see assistantAudioManifest)
// one at a time from a queue, exposes the current line as a caption, and a
// per-frame level for the VoiceOrb.
//
// Ported from the web app's
// src/components/learning/askAssistant/useAssistantVoice.ts. The queueing,
// shuffle-bag picking, and "defer onEnd until the whole queue drains" logic
// is identical; the playback backend is expo-av's Audio.Sound instead of a
// reused <audio> element — a Sound is single-use per load, so each clip gets
// its own instance, unloaded before the next one loads. There's no RN
// equivalent of attaching a real Web Audio analyser to element playback, so
// the level is always the synthetic syllable-ish envelope web already used
// as its own mobile/fallback path (dropping only the desktop-only real
// analyser branch, which has no native equivalent).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { ASSISTANT_CLIPS } from './assistantAudioManifest';
import type { AssistantClip, AssistantClipCategory } from './assistantAudioTypes';
import { createClipPicker } from './clipPicker';

// When playback fails to start we still show the line and move the flow on
// after roughly the time it would have taken to say it.
const BLOCKED_CAPTION_MS = 1600;

interface QueuedLine {
  clip: AssistantClip;
  onEnd?: () => void;
}

export interface AssistantVoice {
  /** Queue a random line from `category`; `onEnd` fires when it finishes (or is skipped because playback failed). */
  say: (category: AssistantClipCategory, onEnd?: () => void) => void;
  /** Stop talking now and drop anything queued. Pending onEnd callbacks are NOT called. */
  interrupt: () => void;
  speaking: boolean;
  caption: string | null;
  getLevel: () => number;
}

export function useAssistantVoice(): AssistantVoice {
  const picker = useMemo(() => createClipPicker(ASSISTANT_CLIPS), []);
  const soundRef = useRef<Audio.Sound | null>(null);
  const queueRef = useRef<QueuedLine[]>([]);
  const currentRef = useRef<QueuedLine | null>(null);
  // onEnd callbacks of finished lines, held until the whole queue drains —
  // callers use onEnd to open the mic, which must never happen mid-clip.
  const drainCallbacksRef = useRef<(() => void)[]>([]);
  const blockedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);

  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<string | null>(null);

  const clearBlockedTimer = () => {
    if (blockedTimerRef.current) {
      clearTimeout(blockedTimerRef.current);
      blockedTimerRef.current = null;
    }
  };

  const unloadCurrentSound = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) {
      sound.setOnPlaybackStatusUpdate(null);
      try {
        await sound.unloadAsync();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const playNextRef = useRef<() => void>(() => {});

  const finishCurrent = useCallback(() => {
    const done = currentRef.current;
    currentRef.current = null;
    clearBlockedTimer();
    void unloadCurrentSound();
    if (done?.onEnd) drainCallbacksRef.current.push(done.onEnd);
    if (queueRef.current.length > 0) {
      playNextRef.current();
      return;
    }
    setSpeaking(false);
    const callbacks = drainCallbacksRef.current;
    drainCallbacksRef.current = [];
    callbacks.forEach((cb) => cb());
  }, [unloadCurrentSound]);

  const playNext = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) {
      setSpeaking(false);
      return;
    }
    currentRef.current = next;
    setCaption(next.clip.text);
    setSpeaking(true);
    startedAtRef.current = Date.now();

    void (async () => {
      await unloadCurrentSound();
      if (currentRef.current !== next) return; // interrupted while unloading
      try {
        const { sound } = await Audio.Sound.createAsync(next.clip.src, { shouldPlay: true });
        if (currentRef.current !== next) {
          // interrupted while loading
          void sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
          if (currentRef.current !== next) return;
          if (!status.isLoaded) {
            if (status.error) finishCurrent();
            return;
          }
          if (status.didJustFinish) finishCurrent();
        });
      } catch {
        // Clip failed to load/play — keep the conversation moving.
        if (currentRef.current !== next) return;
        clearBlockedTimer();
        blockedTimerRef.current = setTimeout(() => {
          if (currentRef.current === next) finishCurrent();
        }, BLOCKED_CAPTION_MS);
      }
    })();
  }, [finishCurrent, unloadCurrentSound]);
  playNextRef.current = playNext;

  const say = useCallback(
    (category: AssistantClipCategory, onEnd?: () => void) => {
      const clip = picker.pick(category);
      if (!clip) {
        if (!onEnd) return;
        if (currentRef.current) drainCallbacksRef.current.push(onEnd);
        else onEnd();
        return;
      }
      queueRef.current.push({ clip, onEnd });
      if (!currentRef.current) playNext();
    },
    [picker, playNext],
  );

  const interrupt = useCallback(() => {
    queueRef.current = [];
    currentRef.current = null;
    drainCallbacksRef.current = [];
    clearBlockedTimer();
    void unloadCurrentSound();
    setSpeaking(false);
  }, [unloadCurrentSound]);

  const getLevel = useCallback(() => {
    if (!currentRef.current) return 0;
    // Synthetic syllable-ish envelope while a line is "playing" — same math
    // web uses as its own mobile/fallback path.
    const t = (Date.now() - startedAtRef.current) / 1000;
    const syllables = Math.abs(Math.sin(t * 9.1)) * 0.55 + Math.abs(Math.sin(t * 3.7 + 1.3)) * 0.3;
    return Math.min(1, 0.15 + syllables);
  }, []);

  useEffect(() => {
    return () => {
      queueRef.current = [];
      currentRef.current = null;
      drainCallbacksRef.current = [];
      clearBlockedTimer();
      void unloadCurrentSound();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { say, interrupt, speaking, caption, getLevel };
}
