// Hands-free voice assistant for asking a doubt about the current lecture.
// Flow: greet out loud -> listen (no tap needed) -> detect end of speech ->
// send to Athena /ask -> narrate progress with short voice cues -> hand off
// to HyperframeAnswerPlayer -> "anything else?" -> listen again. Typing
// works at any point as an alternative to speaking.
//
// Ported from the web app's
// src/components/learning/askAssistant/AskAIAssistant.tsx. The Stage machine
// and all its transitions are unchanged; a full-screen RN Modal replaces the
// web's `createPortal(..., document.body)` overlay, and a TextInput replaces
// the <input> composer. Mounted/unmounted by the parent exactly like web —
// this component doesn't manage its own open/closed visibility.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardScope, isKeyboardControlled, useKeyboardDrivenOffset } from '../keyboard/keyboardStick';
import { usePostLectureAthenaAnswer } from '../../hooks/usePostLectureAthenaAnswer';
import { HyperframeAnswerPlayer } from './HyperframeAnswerPlayer';
import { VoiceOrb, type VoiceOrbMode } from './VoiceOrb';
import { useHandsFreeSpeech } from '../../services/askAssistant/useHandsFreeSpeechNative';
import { useAssistantVoice } from '../../services/askAssistant/useAssistantVoice';
import { cuesForAnswerProgress, type AnswerProgress } from '../../services/askAssistant/statusCues';
import { askLog, askWarn, preview } from '../../services/askAssistant/askLog';
import type { AssistantClipCategory } from '../../services/askAssistant/assistantAudioTypes';

type Stage =
  | 'speaking' // assistant is talking (greeting / follow-up / didn't-catch…), mic opens after
  | 'listening' // mic open, waiting for or hearing the student
  | 'paused' // mic closed — typing, long silence, or mic unavailable; tap the orb to talk
  | 'processing' // question sent, nothing streamed back yet
  | 'answer' // HyperframeAnswerPlayer is showing the answer
  | 'notice'; // out-of-scope / error line, then back to listening

const STILL_THINKING_AFTER_MS = [7000, 16000];

const MIC_PROBLEM_TEXT: Record<string, string> = {
  unsupported: "Voice input isn't available on this device — type your question below.",
  'not-allowed': 'Microphone access is blocked. Allow it in your device settings, or type below.',
  'service-not-allowed': 'Microphone access is blocked. Allow it in your device settings, or type below.',
  'audio-capture': 'No microphone was found. You can type your question below.',
  network: 'Voice recognition needs an internet connection. Type your question below.',
  noisy: "I'm having trouble hearing you clearly. Tap the orb to try again, or type below.",
};

export interface AskAIAssistantProps {
  /** "mid" = opened from the player's Ask AI button, "end" = lecture just finished. */
  trigger: 'mid' | 'end';
  onClose: () => void;
  subjectName?: string;
  athenaSubjectId: string;
  athenaChapterId?: string;
  athenaTopicId?: string;
  speechLang?: string;
}

export function AskAIAssistant({
  trigger,
  onClose,
  subjectName,
  athenaSubjectId,
  athenaChapterId,
  athenaTopicId,
  speechLang = 'en-IN',
}: AskAIAssistantProps) {
  const { say, interrupt, speaking, caption, getLevel: getVoiceLevel } = useAssistantVoice();
  const { state: answer, ask, reset } = usePostLectureAthenaAnswer();
  const insets = useSafeAreaInsets();
  // The composer sits on the window's bottom edge, which on Android 15
  // edge-to-edge (targetSdk 36) runs *under* the system navigation bar — hence
  // the bottom inset. While the keyboard is up the nav bar is covered anyway,
  // so the inset collapses to a small gap instead of stacking with the lift.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [stage, setStage] = useState<Stage>('speaking');
  const [question, setQuestion] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [micProblem, setMicProblem] = useState<string | null>(null);

  const stageRef = useRef<Stage>(stage);
  const silenceStrikesRef = useRef(0);
  const unclearStrikesRef = useRef(0);
  const progressRef = useRef<AnswerProgress>({ phase: 'idle', segmentCount: 0 });
  const composerFocusedRef = useRef(false);

  const goTo = useCallback((next: Stage) => {
    if (stageRef.current !== next) askLog('stage', `${stageRef.current} -> ${next}`);
    stageRef.current = next;
    setStage(next);
  }, []);

  // Handlers the speech hook and voice-clip callbacks call later — kept in a
  // ref so those long-lived callbacks always reach the latest closures.
  const actions = useRef({
    submit: (_text: string) => {},
    startListening: () => {},
    didntCatch: () => {},
    noSpeech: () => {},
  });

  const speech = useHandsFreeSpeech({
    lang: speechLang,
    onUtterance: (text) => actions.current.submit(text),
    onUnclear: () => actions.current.didntCatch(),
    onNoSpeechTimeout: () => actions.current.noSpeech(),
  });

  // Speak a line, then open the mic — unless the student moved on meanwhile
  // (typed, closed, tapped the orb), in which case the stage no longer matches.
  const sayThenListen = useCallback(
    (category: AssistantClipCategory, fromStage: Stage) => {
      goTo(fromStage);
      say(category, () => {
        if (stageRef.current === fromStage) actions.current.startListening();
      });
    },
    [goTo, say],
  );

  actions.current.startListening = () => {
    // Never open the mic under a student who's mid-typing — a spoken word
    // would submit and wipe their draft.
    if (composerFocusedRef.current) {
      askLog('mic', 'not opening — the composer has focus');
      goTo('paused');
      return;
    }
    if (!speech.supported) {
      askWarn('mic', 'speech recognition unsupported on this device');
      setMicProblem('unsupported');
      goTo('paused');
      return;
    }
    askLog('mic', 'opening');
    setMicProblem(null);
    goTo('listening');
    void speech.start();
  };

  actions.current.submit = (raw: string) => {
    const text = raw.trim();
    if (!text) {
      askWarn('submit', 'ignored an empty question');
      return;
    }
    askLog('submit', preview(text));
    speech.stop();
    interrupt();
    silenceStrikesRef.current = 0;
    unclearStrikesRef.current = 0;
    setQuestion(text);
    setTyped('');
    setNotice(null);
    goTo('processing');
    ask({ question: text, subjectId: athenaSubjectId, chapterId: athenaChapterId, topicId: athenaTopicId });
  };

  // In a noisy room this could otherwise loop forever — stop asking after a
  // couple of tries and let the student tap or type.
  actions.current.didntCatch = () => {
    unclearStrikesRef.current += 1;
    if (unclearStrikesRef.current <= 2) {
      sayThenListen('didntCatch', 'speaking');
    } else {
      unclearStrikesRef.current = 0;
      setMicProblem('noisy');
      goTo('paused');
    }
  };

  actions.current.noSpeech = () => {
    silenceStrikesRef.current += 1;
    if (silenceStrikesRef.current === 1) {
      sayThenListen('stillThere', 'speaking');
    } else {
      goTo('paused');
    }
  };

  // Greet once on open.
  useEffect(() => {
    sayThenListen(trigger === 'end' ? 'greetingEnd' : 'greeting', 'speaking');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mic failed to start or died (permission, no device, network), or went
  // off without us stopping it (another feature took the voice lock).
  const prevSpeechStatusRef = useRef(speech.status);
  useEffect(() => {
    const prev = prevSpeechStatusRef.current;
    if (prev !== speech.status) askLog('mic', `status ${prev} -> ${speech.status}`);
    prevSpeechStatusRef.current = speech.status;
    if (stageRef.current !== 'listening') return;
    if (speech.status === 'error') {
      setMicProblem(speech.error ?? 'error');
      goTo('paused');
    } else if (speech.status === 'off' && prev !== 'off' && prev !== 'error') {
      goTo('paused');
    }
  }, [speech.status, speech.error, goTo]);

  // Narrate the live answer progress with short voice cues.
  useEffect(() => {
    const next: AnswerProgress = { phase: answer.phase, segmentCount: answer.segments.length };
    const cues = cuesForAnswerProgress(progressRef.current, next);
    progressRef.current = next;

    for (const cue of cues) {
      if (cue === 'interrupt') {
        interrupt();
      } else if ((cue === 'outOfScope' || cue === 'error') && stageRef.current === 'processing') {
        setNotice(
          answer.errorMessage ||
            (cue === 'outOfScope'
              ? "I couldn't find that in this subject's material. Try asking about this lecture."
              : 'Something went wrong. Please try again.'),
        );
        interrupt();
        sayThenListen(cue, 'notice');
      } else {
        // Includes a late error while a partial answer is already on screen —
        // the answer player shows it; don't yank the student out of it.
        say(cue);
      }
    }

    if (stageRef.current === 'processing') {
      if (next.segmentCount > 0 || next.phase === 'video_ready') {
        goTo('answer');
      } else if (next.phase === 'text_only') {
        setNotice("I couldn't put together an answer for that. Try rephrasing your question?");
        interrupt();
        sayThenListen('error', 'notice');
      }
    }
  }, [answer.phase, answer.segments.length, answer.errorMessage, say, interrupt, sayThenListen, goTo]);

  // Taking a while with nothing streamed yet — reassure out loud.
  useEffect(() => {
    if (stage !== 'processing') return;
    const timers = STILL_THINKING_AFTER_MS.map((ms) =>
      setTimeout(() => {
        if (stageRef.current === 'processing') say('stillThinking');
      }, ms),
    );
    return () => timers.forEach((t) => clearTimeout(t));
  }, [stage, say]);

  // Closing mid-answer must stop the /ask stream and the video polling.
  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const backFromAnswer = () => {
    interrupt();
    reset();
    progressRef.current = { phase: 'idle', segmentCount: 0 };
    setQuestion(null);
    sayThenListen('followUp', 'speaking');
  };

  const onOrbPress = () => {
    const current = stageRef.current;
    if (current === 'speaking' || current === 'notice') {
      interrupt();
      actions.current.startListening();
    } else if (current === 'listening') {
      speech.stop();
      goTo('paused');
    } else if (current === 'paused') {
      actions.current.startListening();
    }
  };

  const onComposerFocus = () => {
    composerFocusedRef.current = true;
    const current = stageRef.current;
    if (current === 'listening' || current === 'speaking' || current === 'notice') {
      speech.stop();
      interrupt();
      goTo('paused');
    }
  };
  const onComposerBlur = () => {
    composerFocusedRef.current = false;
  };

  const onComposerSubmit = () => {
    actions.current.submit(typed);
  };

  const getSpeechLevel = speech.getLevel;
  const orbLevel = useCallback(
    () => (stageRef.current === 'listening' ? getSpeechLevel() : getVoiceLevel()),
    [getSpeechLevel, getVoiceLevel],
  );

  const requestClose = () => {
    // Mirrors web's Escape-key guard: the answer player has its own back
    // button as the close path while an answer is showing.
    if (stageRef.current !== 'answer') onClose();
  };

  if (stage === 'answer') {
    return (
      <Modal visible animationType="slide" onRequestClose={requestClose} statusBarTranslucent>
        <HyperframeAnswerPlayer
          answerId={answer.meta?.answer_id ?? null}
          phase={answer.phase}
          segments={answer.segments}
          video={answer.video}
          errorMessage={answer.errorMessage}
          questionText={question ?? ''}
          onClose={backFromAnswer}
        />
      </Modal>
    );
  }

  const orbMode: VoiceOrbMode =
    stage === 'processing'
      ? 'thinking'
      : stage === 'listening'
        ? 'listening'
        : speaking
          ? 'speaking'
          : stage === 'notice'
            ? 'error'
            : 'idle';

  const hearing = stage === 'listening' && speech.status === 'hearing';
  const statusText =
    stage === 'listening'
      ? hearing
        ? 'Listening…'
        : "Go ahead, I'm listening"
      : stage === 'processing'
        ? answer.phase === 'streaming'
          ? 'Searching your lecture material…'
          : 'Thinking…'
        : stage === 'paused'
          ? micProblem
            ? MIC_PROBLEM_TEXT[micProblem] ?? 'Voice input stopped. Tap the orb to try again, or type below.'
            : 'Tap the orb to talk, or type below'
          : null;

  const liveTranscript = stage === 'listening' ? speech.interimText : '';
  const assistantLine =
    (stage === 'speaking' || stage === 'notice' || stage === 'processing') && speaking ? caption : null;

  const orbLabel =
    stage === 'listening'
      ? 'Stop listening'
      : stage === 'paused'
        ? 'Start talking'
        : stage === 'speaking'
          ? 'Skip and start talking'
          : 'Assistant is thinking';

  return (
    <Modal visible animationType="slide" onRequestClose={requestClose} statusBarTranslucent>
      {/* KeyboardProvider's own view is flex:1, so it has to wrap the
          full-height overlay — wrapping just the composer would make it claim
          half the column and park the input mid-screen. */}
      <KeyboardScope>
        <View style={styles.overlay}>
          <View style={styles.topbar}>
            <View style={styles.topbarTitle}>
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={styles.topbarTitleText}>Ask AI</Text>
              {subjectName && <Text style={styles.topbarSubject}> · {subjectName}</Text>}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close and return to the lecture" style={styles.iconBtn}>
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.center}>
            {/* Landscape with the keyboard up leaves very little height — shrink
                the orb rather than letting it crowd out the status text. */}
            <VoiceOrb
              mode={orbMode}
              getLevel={orbLevel}
              onPress={stage === 'processing' ? undefined : onOrbPress}
              accessibilityLabel={orbLabel}
              size={keyboardHeight > 0 ? 54 : 88}
            />

            <View style={styles.textBlock}>
              {notice && stage !== 'processing' && <Text style={styles.notice}>{notice}</Text>}
              {question && stage === 'processing' && (
                <Text style={styles.question}>
                  <Text style={styles.questionLabel}>You asked{'\n'}</Text>
                  {question}
                </Text>
              )}
              {statusText && (
                <Text style={[styles.status, hearing && styles.statusHearing, micProblem && stage === 'paused' && styles.statusProblem]}>
                  {statusText}
                </Text>
              )}
              {!!liveTranscript && <Text style={styles.transcript}>{liveTranscript}</Text>}
              {!!assistantLine && !liveTranscript && <Text style={styles.caption}>{assistantLine}</Text>}
            </View>
          </View>

          <Composer
            value={typed}
            onChangeText={setTyped}
            onFocus={onComposerFocus}
            onBlur={onComposerBlur}
            onSubmit={onComposerSubmit}
            disabled={stage === 'processing'}
            listening={stage === 'listening'}
            micProblem={!!micProblem}
            keyboardHeight={keyboardHeight}
            insetBottom={insets.bottom}
          />
        </View>
      </KeyboardScope>
    </Modal>
  );
}

interface ComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: () => void;
  disabled: boolean;
  listening: boolean;
  micProblem: boolean;
  /** 0 when closed; only used for the Expo Go fallback and the bottom inset. */
  keyboardHeight: number;
  insetBottom: number;
}

/**
 * The bottom-anchored input bar. Split out of AskAIAssistant because
 * `useKeyboardDrivenOffset` reads KeyboardProvider's React context, so it has
 * to run in a component *inside* the KeyboardScope above.
 *
 * It rides the keyboard via an animated bottom padding: this is the last child
 * of a flex column, so growing it lifts the bar and shrinks `center` above it,
 * and it settles back down as the keyboard retracts.
 */
function Composer({
  value,
  onChangeText,
  onFocus,
  onBlur,
  onSubmit,
  disabled,
  listening,
  micProblem,
  keyboardHeight,
  insetBottom,
}: ComposerProps) {
  const controlled = isKeyboardControlled;
  const offset = useKeyboardDrivenOffset(controlled);

  // Expo Go has no native keyboard module, so there `useKeyboardDrivenOffset`
  // stays at 0 and the legacy iOS lift is driven from the parent's listener
  // instead (Android there falls back to the native window resize).
  useEffect(() => {
    if (controlled) return;
    offset.value = Platform.OS === 'ios' ? keyboardHeight : 0;
  }, [controlled, keyboardHeight, offset]);

  const lift = useAnimatedStyle(() => ({ paddingBottom: offset.value }));

  return (
    <Animated.View style={lift}>
      <View
        style={[
          styles.composer,
          // While the keyboard covers the navigation bar the inset would only
          // add a dead gap, so it collapses to a small one.
          { paddingBottom: keyboardHeight > 0 ? 10 : Math.max(insetBottom, 12) },
        ]}
      >
        <View style={[styles.micChip, listening && styles.micChipLive]}>
          <Ionicons
            name={listening ? 'mic' : micProblem ? 'mic-off' : 'keypad-outline'}
            size={15}
            color={listening ? '#0B0B14' : '#9CA3AF'}
          />
        </View>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder="Prefer typing? Ask your question here…"
          placeholderTextColor="#6B7280"
          editable={!disabled}
          returnKeyType="send"
          onSubmitEditing={onSubmit}
        />
        <Pressable
          onPress={onSubmit}
          disabled={!value.trim() || disabled}
          style={[styles.sendBtn, (!value.trim() || disabled) && styles.sendBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send question"
        >
          <Ionicons name="send" size={16} color="#fff" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#0B0B14',
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
  },
  topbarTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topbarTitleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  topbarSubject: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24,
  },
  textBlock: {
    alignItems: 'center',
    gap: 8,
  },
  notice: {
    color: '#FDA4AF',
    fontSize: 14,
    textAlign: 'center',
  },
  question: {
    color: '#E5E7EB',
    fontSize: 15,
    textAlign: 'center',
  },
  questionLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  status: {
    color: '#D1D5DB',
    fontSize: 14,
    textAlign: 'center',
  },
  statusHearing: {
    color: '#A78BFA',
    fontWeight: '600',
  },
  statusProblem: {
    color: '#FDA4AF',
  },
  transcript: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  caption: {
    color: '#E5E7EB',
    fontSize: 15,
    textAlign: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  micChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  micChipLive: {
    backgroundColor: '#A78BFA',
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 8,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
