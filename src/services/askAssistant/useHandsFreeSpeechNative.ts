/**
 * Headless hands-free speech layer for the mobile "Ask AI" voice assistant.
 *
 * Same public shape and lifecycle as the web app's
 * src/components/learning/askAssistant/useHandsFreeSpeech.ts: start() opens
 * the mic and listens with no tap; when the student stops talking the
 * utterance detector (./utteranceDetector.ts) decides the utterance is over,
 * the hook STOPS ITSELF (status "off", mic released) and only then invokes
 * onUtterance / onUnclear / onNoSpeechTimeout. Call start() again to listen
 * again. interimText is cleared on start(), not on stop(), so the last
 * transcript stays readable until the next listen.
 *
 * Platform notes (native, via expo-speech-recognition):
 *  - Uses the OS's own speech framework (SFSpeechRecognizer on iOS,
 *    SpeechRecognizer on Android) via a single global native module — there's
 *    no per-instance recognizer object to construct/destroy like the web's
 *    SpeechRecognition class, so "is this event still mine" is tracked with a
 *    sessionId guard instead of discarding a dead instance.
 *  - The native recognizer provides its own `volumechange` event (range -2..10,
 *    <=0 inaudible) as a direct level signal, so unlike web there's no need for
 *    a separate analyser-stream-vs-synthetic-envelope split — mic contention
 *    between level metering and recognition isn't a concern here because both
 *    come from the same OS pipeline.
 *  - `continuous: true` is requested, but — mirroring the web engine's
 *    defensive assumption that browsers end "continuous" sessions on their own
 *    — this still auto-restarts on "end" with the same restart-storm backoff,
 *    since OS recognizers are also known to time out on silence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionResultEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';
import { voiceLock } from '../voiceLock';
import {
  createRestartThrottle,
  createUtteranceDetector,
  joinSegments,
  joinText,
  type UtteranceDetector,
} from './utteranceDetector';

export type HandsFreeStatus = 'off' | 'starting' | 'listening' | 'hearing' | 'error';

export interface HandsFreeSpeechOptions {
  lang?: string; // default "en-IN"; applied on next start()
  silenceMs?: number; // end-of-utterance silence after speech, default 1400
  noSpeechTimeoutMs?: number; // nothing heard at all since start -> give up, default 30000
  minChars?: number; // shorter transcript counts as unclear, default 3
  onUtterance: (text: string) => void;
  onUnclear?: () => void; // speech/noise detected but transcript empty or too short
  onNoSpeechTimeout?: () => void;
}

export interface HandsFreeSpeech {
  supported: boolean;
  status: HandsFreeStatus;
  interimText: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  getLevel: () => number;
}

// -- Tunables (same values as web) -------------------------------------------
const DEFAULT_LANG = 'en-IN';
const DEFAULT_SILENCE_MS = 1400;
const DEFAULT_NO_SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_CHARS = 3;
const TICK_MS = 100;
/** "hearing" falls back to "listening" after this long without speech activity. */
const HEARING_HOLD_MS = 900;
/** Consecutive network errors (without a result in between) before giving up. */
const MAX_NETWORK_ERRORS = 3;
/** Consecutive foreign "aborted" errors before giving up. */
const MAX_FOREIGN_ABORTS = 4;
const OWNER = 'askAssistant' as const;

function now(): number {
  return Date.now();
}

interface EngineDeps {
  getOpts: () => HandsFreeSpeechOptions;
  setStatus: (s: HandsFreeStatus) => void;
  setInterim: (t: string) => void;
  setError: (e: string | null) => void;
}

function createEngine(d: EngineDeps) {
  let active = false;
  let runId = 0; // bumps on every start/teardown; invalidates in-flight async work
  let sessionId = 0; // bumps per listen session; invalidates stale native events
  let startPromise: Promise<void> | null = null;
  let status: HandsFreeStatus = 'off';

  let detector: UtteranceDetector | null = null;
  let lang = DEFAULT_LANG;
  let noSpeechTimeoutMs = DEFAULT_NO_SPEECH_TIMEOUT_MS;

  let committed = ''; // text from a previous native session (this listen), after a restart
  let finalSegments: string[] = []; // final segments heard in the CURRENT native session
  let sessionInterim = '';

  let startedAt = 0;
  let heard = false;
  let lastActivityAt = 0;
  let ownAbort = false; // our own stop()/teardown() is about to abort() — ignore the resulting error/end

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const throttle = createRestartThrottle({ baseDelayMs: 150, backoffDelayMs: 1000, windowMs: 5000, maxInWindow: 5 });
  let networkErrors = 0;
  let foreignAborts = 0;

  let level = 0; // smoothed 0..1, fed by the volumechange listener

  type Removable = { remove: () => void };
  let listeners: Removable[] = [];

  const setStatus = (s: HandsFreeStatus) => {
    if (status === s) return;
    status = s;
    d.setStatus(s);
  };

  const getLevel = (): number => (active ? level : 0);

  const clearTimers = () => {
    if (tickTimer) clearInterval(tickTimer);
    if (restartTimer) clearTimeout(restartTimer);
    tickTimer = null;
    restartTimer = null;
  };

  const detachListeners = () => {
    listeners.forEach((l) => {
      try {
        l.remove();
      } catch {
        /* ignore */
      }
    });
    listeners = [];
  };

  const teardown = () => {
    active = false;
    runId++;
    sessionId++;
    startPromise = null;
    clearTimers();
    ownAbort = true;
    detachListeners();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* ignore */
    }
    level = 0;
    detector?.reset();
    detector = null;
    voiceLock.release(OWNER);
  };

  const stop = () => {
    const wasActive = active;
    teardown();
    if (wasActive) setStatus('off'); // an existing "error" status survives a redundant stop()
  };

  const fail = (code: string) => {
    teardown();
    d.setError(code);
    setStatus('error');
  };

  const finish = (invoke: () => void) => {
    stop(); // mic released BEFORE the app reacts (it will play clips next)
    try {
      invoke();
    } catch (e) {
      console.error('[useHandsFreeSpeechNative] callback threw:', e);
    }
  };

  const markActivity = () => {
    heard = true;
    lastActivityAt = now();
    if (status === 'listening' || status === 'starting') setStatus('hearing');
  };

  const onTick = () => {
    if (!active || !detector) return;
    const t = now();
    const dec = detector.push({ type: 'tick', at: t });
    if (dec.kind === 'finalize') {
      const text = dec.text;
      finish(() => d.getOpts().onUtterance(text));
      return;
    }
    if (dec.kind === 'unclear') {
      finish(() => d.getOpts().onUnclear?.());
      return;
    }
    if (!heard && !detector.inUtterance && t - startedAt >= noSpeechTimeoutMs) {
      finish(() => d.getOpts().onNoSpeechTimeout?.());
      return;
    }
    if (status === 'hearing' && t - lastActivityAt > HEARING_HOLD_MS) setStatus('listening');
  };

  const scheduleRestart = () => {
    if (!active || restartTimer) return;
    const delay = throttle.next(now());
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (active) startRecognitionSession();
    }, delay);
  };

  const handleError = (code: string) => {
    switch (code) {
      case 'no-speech':
      case 'speech-timeout':
        // The OS's own silence timeout — the "end" event will restart us.
        return;
      case 'aborted':
      case 'interrupted':
        if (++foreignAborts >= MAX_FOREIGN_ABORTS) fail('aborted');
        return;
      case 'network':
        if (++networkErrors >= MAX_NETWORK_ERRORS) fail('network');
        return;
      case 'busy':
        // Another session is already running natively — treat like a foreign abort.
        if (++foreignAborts >= MAX_FOREIGN_ABORTS) fail('aborted');
        return;
      default: // not-allowed, service-not-allowed, audio-capture, language-not-supported, …
        fail(code || 'unknown');
    }
  };

  function startRecognitionSession() {
    if (!active) return;
    const id = ++sessionId;
    const live = () => id === sessionId && active;

    finalSegments = [];
    sessionInterim = '';

    const onStart = () => {
      if (live() && status === 'starting') setStatus('listening');
    };
    const onSpeechStart = () => {
      if (!live()) return;
      detector?.push({ type: 'speechStart', at: now() });
      markActivity();
    };
    const onSpeechEnd = () => {
      if (live() && status === 'hearing') setStatus('listening');
    };
    const onVolumeChange = (ev: { value: number }) => {
      if (!live()) return;
      // Native range is roughly -2..10 (<=0 inaudible); normalize to 0..1.
      const target = Math.max(0, Math.min(1, ev.value / 10));
      level += (target - level) * (target > level ? 0.5 : 0.12); // fast attack, slower release
      if (level < 0.01) level = 0;
    };
    const onResult = (ev: ExpoSpeechRecognitionResultEvent) => {
      if (!live()) return;
      networkErrors = 0;
      foreignAborts = 0;
      const transcript = ev.results?.[0]?.transcript ?? '';
      if (ev.isFinal) {
        if (transcript) finalSegments.push(transcript);
        sessionInterim = '';
      } else {
        sessionInterim = transcript;
      }
      const sessionFinal = joinSegments(finalSegments);
      const fullFinal = joinText(committed, sessionFinal);
      detector?.push({ type: 'result', at: now(), finalText: fullFinal, interimText: sessionInterim });
      d.setInterim(joinText(fullFinal, sessionInterim));
      markActivity();
    };
    const onError = (ev: ExpoSpeechRecognitionErrorEvent) => {
      if (!live()) return;
      if (ownAbort) {
        ownAbort = false;
        return;
      }
      handleError(ev?.error ?? 'unknown');
    };
    const onEnd = () => {
      if (id !== sessionId) return;
      if (ownAbort) {
        ownAbort = false;
        return;
      }
      if (!active) return;
      // Keep what this session heard — including an interim chunk never finalized.
      committed = joinText(committed, joinSegments(finalSegments), sessionInterim);
      finalSegments = [];
      sessionInterim = '';
      scheduleRestart();
    };

    listeners = [
      ExpoSpeechRecognitionModule.addListener('start', onStart),
      ExpoSpeechRecognitionModule.addListener('speechstart', onSpeechStart),
      ExpoSpeechRecognitionModule.addListener('speechend', onSpeechEnd),
      ExpoSpeechRecognitionModule.addListener('volumechange', onVolumeChange),
      ExpoSpeechRecognitionModule.addListener('result', onResult),
      ExpoSpeechRecognitionModule.addListener('error', onError),
      ExpoSpeechRecognitionModule.addListener('end', onEnd),
    ];

    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });
    } catch {
      detachListeners();
      scheduleRestart();
    }
  }

  const start = (): Promise<void> => {
    if (active) return startPromise ?? Promise.resolve();

    active = true;
    const myRun = ++runId;
    const o = d.getOpts();
    lang = o.lang || DEFAULT_LANG;
    noSpeechTimeoutMs = o.noSpeechTimeoutMs ?? DEFAULT_NO_SPEECH_TIMEOUT_MS;
    detector = createUtteranceDetector({
      silenceMs: o.silenceMs ?? DEFAULT_SILENCE_MS,
      minChars: o.minChars ?? DEFAULT_MIN_CHARS,
    });
    committed = '';
    finalSegments = [];
    sessionInterim = '';
    heard = false;
    lastActivityAt = 0;
    networkErrors = 0;
    foreignAborts = 0;
    throttle.reset();
    level = 0;
    d.setError(null);
    d.setInterim('');
    setStatus('starting');

    voiceLock.acquire(OWNER); // releases whichever feature held the mic
    voiceLock.onRelease(OWNER, () => {
      if (active) stop();
    });

    const p = (async () => {
      try {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (myRun !== runId || !active) return;
        if (!perm.granted) {
          fail('not-allowed');
          return;
        }
      } catch {
        if (myRun !== runId || !active) return;
        fail('not-allowed');
        return;
      }
      if (myRun !== runId || !active) return;
      startedAt = now();
      tickTimer = setInterval(onTick, TICK_MS);
      startRecognitionSession();
    })();
    startPromise = p;
    return p;
  };

  return { start, stop, getLevel };
}

type Engine = ReturnType<typeof createEngine>;

// -- Hook ---------------------------------------------------------------------
export function useHandsFreeSpeech(opts: HandsFreeSpeechOptions): HandsFreeSpeech {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // expo-speech-recognition is a native module: once linked, it's always
  // available on the platforms this app ships (iOS 13+ / Android), unlike the
  // web's optional browser API — so "supported" is a constant here, not a
  // runtime feature check.
  const [supported] = useState(true);
  const [status, setStatus] = useState<HandsFreeStatus>('off');
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(false);
  const engineRef = useRef<Engine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createEngine({
      getOpts: () => optsRef.current,
      setStatus: (s) => {
        if (mountedRef.current) setStatus(s);
      },
      setInterim: (t) => {
        if (mountedRef.current) setInterimText(t);
      },
      setError: (e) => {
        if (mountedRef.current) setError(e);
      },
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    const engine = engineRef.current;
    return () => {
      mountedRef.current = false;
      engine?.stop();
    };
  }, []);

  const start = useCallback(() => engineRef.current!.start(), []);
  const stop = useCallback(() => engineRef.current!.stop(), []);
  const getLevel = useCallback(() => engineRef.current!.getLevel(), []);

  return { supported, status, interimText, error, start, stop, getLevel };
}
