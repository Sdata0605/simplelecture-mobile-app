/**
 * V4LectureNotesPanel — the in-player lecture-note editor for the V4 player
 * (Task #96: "Let students write lecture notes and manage them from My Notes").
 *
 * Two layout variants driven by `variant`:
 *   - "portrait"  → keyboard-safe bottom sheet that slides up over the player
 *                   (playback keeps running behind it).
 *   - "side"      → landscape / fullscreen side panel docked to the right edge
 *                   (playback keeps running to its left).
 *
 * The panel never pauses playback — it is purely additive UI. It reads/writes a
 * single free-text lecture notebook scoped to the current chapter via the
 * `useStudentNoteEditor` hook (owned by the notes-service agent).
 *
 * Persistence guarantees:
 *   - Autosaves on a debounce while typing (handled by the hook).
 *   - Flushes any pending edit when the panel closes (onRequestClose) and, since
 *     the editor unmounts with the player, the hook is driven to flush on player
 *     unmount / back-out too (the screen keeps the panel mounted until dismissed
 *     and calls flush via onRequestClose).
 *
 * Invalid / missing route IDs (jobId / subjectId / chapterId / topicId) or a
 * missing signed-in user render an explicit disabled message instead of a broken
 * editor, and the hook is never mounted with an incomplete scope.
 *
 * useStudentNoteEditor contract (as implemented by the hook agent):
 *   useStudentNoteEditor({ userId, subjectId, chapterId }) => {
 *     text, setText, status, wordCount, loading, hasPendingCloudSave,
 *     flush, clear, retry, reload
 *   }
 *   status ∈ 'idle'|'loading'|'saving'|'saved'|'saved_local'|'error'
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { EdgeInsets } from 'react-native-safe-area-context';
import {
  KeyboardScope,
  useKeyboardDrivenOffset,
  isKeyboardControlled,
} from '../keyboard/keyboardStick';
import {
  useStudentNoteEditor,
  NoteSaveStatus,
} from '../../hooks/useStudentNoteEditor';
import { useAuth } from '../../context/AuthContext';

const C = {
  bg: '#0d1117',
  surface: '#161b22',
  elevated: '#21262d',
  border: 'rgba(255,255,255,0.08)',
  text: '#e6edf3',
  muted: 'rgba(230,237,243,0.5)',
  faint: 'rgba(230,237,243,0.32)',
  gold: '#f6c44e',
  amber: '#ff9f43',
  rose: '#ff6b8a',
  green: '#7ee787',
};

export type V4NotesVariant = 'portrait' | 'side';

interface V4LectureNotesPanelProps {
  visible: boolean;
  variant: V4NotesVariant;
  /** Route IDs scoping the note. Any missing → disabled message. */
  jobId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  /** Topic context shown in the header (falls back to a generic label). */
  topicTitle?: string;
  insets: EdgeInsets;
  /** Called after the pending edit is flushed on close. */
  onRequestClose: () => void;
  /** Lets the player flush notes before its own close/back action. */
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
}

function statusLabel(
  status: NoteSaveStatus,
  hasPending: boolean
): { text: string; color: string } {
  switch (status) {
    case 'error':
      return { text: 'Save failed', color: C.rose };
    case 'saving':
      return { text: 'Saving to your account…', color: C.muted };
    case 'loading':
      return { text: 'Loading saved notes…', color: C.muted };
    case 'local':
      return { text: 'Saved locally — cloud sync will retry', color: C.amber };
    case 'saved':
      return { text: 'Saved', color: C.green };
    default:
      return { text: hasPending ? 'Unsaved changes' : 'Not saved yet', color: C.faint };
  }
}

/**
 * Inner editor: only mounted once all IDs + the user are valid, so the hook
 * always runs with a real scope.
 */
function NotesEditor({
  userId, subjectId, chapterId, jobId, topicId, topicTitle,
  variant, insets, onRequestClose, onFlushReady,
}: {
  userId: string;
  subjectId: string;
  chapterId: string;
  jobId: string;
  topicId: string;
  topicTitle?: string;
  variant: V4NotesVariant;
  insets: EdgeInsets;
  onRequestClose: () => void;
  onFlushReady?: (flush: (() => Promise<void>) | null) => void;
}) {
  // Pass jobId + topicId so the hook saves against the real lecture topic note
  // (its documented lecture-player override) rather than the aggregate notebook.
  const editor = useStudentNoteEditor({ userId, subjectId, chapterId, jobId, topicId });

  // Real-time keyboard offset: only meaningful for the portrait bottom sheet.
  const keyboardControlled = variant === 'portrait' && isKeyboardControlled;
  const keyboardOffset = useKeyboardDrivenOffset(keyboardControlled);
  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardOffset.value,
  }));

  const stat = statusLabel(editor.status, editor.hasPendingCloudSave);
  const showRetry = editor.status === 'error' || editor.status === 'local';

  useEffect(() => {
    onFlushReady?.(editor.flush);
    return () => onFlushReady?.(null);
  }, [editor.flush, onFlushReady]);

  const handleClose = useCallback(() => {
    Promise.resolve(editor.flush()).catch(() => {}).finally(onRequestClose);
  }, [editor.flush, onRequestClose]);

  const header = (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.headerLabel}>LECTURE NOTES</Text>
        <Text style={styles.headerTopic} numberOfLines={1}>
          {topicTitle || 'This topic'}
        </Text>
      </View>
      <TouchableOpacity onPress={handleClose} style={styles.closeBtn} activeOpacity={0.7}>
        <Ionicons name="close" size={18} color={C.rose} />
      </TouchableOpacity>
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      <Text style={styles.wordCount}>
        {editor.wordCount} {editor.wordCount === 1 ? 'word' : 'words'}
      </Text>
      <View style={styles.statusRow}>
        {editor.status === 'saving' && (
          <ActivityIndicator size="small" color={C.muted} style={{ marginRight: 6 }} />
        )}
        <Text style={[styles.statusText, { color: stat.color }]}>{stat.text}</Text>
        {showRetry && (
          <TouchableOpacity onPress={editor.retry} style={styles.retryBtn} activeOpacity={0.7}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const input = (
    <TextInput
      style={styles.input}
      value={editor.content}
      onChangeText={editor.setContent}
      editable={!editor.isLoading}
      placeholder="Jot down what you're learning… key ideas, questions, formulas."
      placeholderTextColor={C.faint}
      multiline
      textAlignVertical="top"
      spellCheck
      autoCorrect
      autoCapitalize="sentences"
      keyboardAppearance="dark"
      scrollEnabled
    />
  );

  if (variant === 'side') {
    return (
      <View
        style={[
          styles.sidePanel,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingRight: insets.right },
        ]}
      >
        {header}
        {input}
        {footer}
      </View>
    );
  }

  // Portrait bottom sheet — animated padding keeps the editor above the keyboard
  // on devices where native resize is ignored.
  return (
    <Reanimated.View
      style={[
        styles.bottomSheet,
        { paddingBottom: insets.bottom },
        keyboardControlled ? sheetAnimatedStyle : null,
      ]}
    >
      <View style={styles.grabber} />
      {header}
      {input}
      {footer}
    </Reanimated.View>
  );
}

/**
 * Disabled state: shown when any route ID / the user is missing so the editor
 * never loads with an invalid scope. Explains explicitly why notes are off.
 */
function DisabledPanel({
  variant, insets, onRequestClose, reason,
}: {
  variant: V4NotesVariant;
  insets: EdgeInsets;
  onRequestClose: () => void;
  reason: string;
}) {
  const body = (
    <>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerLabel}>LECTURE NOTES</Text>
        </View>
        <TouchableOpacity onPress={onRequestClose} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={18} color={C.rose} />
        </TouchableOpacity>
      </View>
      <View style={styles.disabledBody}>
        <Ionicons name="lock-closed-outline" size={28} color={C.faint} />
        <Text style={styles.disabledText}>{reason}</Text>
      </View>
    </>
  );

  if (variant === 'side') {
    return (
      <View
        style={[
          styles.sidePanel,
          { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, paddingRight: insets.right },
        ]}
      >
        {body}
      </View>
    );
  }
  return (
    <View style={[styles.bottomSheet, { paddingBottom: insets.bottom }]}>
      <View style={styles.grabber} />
      {body}
    </View>
  );
}

export default function V4LectureNotesPanel({
  visible, variant, jobId, subjectId, chapterId, topicId,
  topicTitle, insets, onRequestClose, onFlushReady,
}: V4LectureNotesPanelProps) {
  const { user } = useAuth();
  const localFlushRef = useRef<(() => Promise<void>) | null>(null);
  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    localFlushRef.current = flush;
    onFlushReady?.(flush);
  }, [onFlushReady]);
  const flushThenClose = useCallback(() => {
    Promise.resolve(localFlushRef.current?.())
      .catch(() => {})
      .finally(onRequestClose);
  }, [onRequestClose]);

  if (!visible) return null;

  // The hook keys on user + subject + chapter; the player also requires job +
  // topic context to identify the lecture. Any missing → explicit disabled UI.
  const missingScope = !jobId || !subjectId || !chapterId || !topicId;
  const reason = missingScope
    ? "Notes aren't available for this lecture — it's missing the topic details needed to save them. Open this lecture from your course to take notes."
    : !user?.id
      ? 'Sign in to write and save lecture notes for this topic.'
      : '';
  const canEdit = !missingScope && !!user?.id;

  const container = (
    <View style={styles.overlay} pointerEvents="box-none">
      <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={flushThenClose} />
      {canEdit ? (
        <NotesEditor
          userId={user!.id}
          subjectId={subjectId!}
          chapterId={chapterId!}
          jobId={jobId!}
          topicId={topicId!}
          topicTitle={topicTitle}
          variant={variant}
          insets={insets}
          onRequestClose={onRequestClose}
          onFlushReady={registerFlush}
        />
      ) : (
        <DisabledPanel
          variant={variant}
          insets={insets}
          onRequestClose={onRequestClose}
          reason={reason}
        />
      )}
    </View>
  );

  // Only wrap in KeyboardScope for the portrait sheet (side panel doesn't need
  // keyboard tracking; landscape keyboards are handled natively).
  return variant === 'portrait' ? <KeyboardScope>{container}</KeyboardScope> : container;
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 200,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  // Portrait bottom sheet
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    minHeight: '45%',
    backgroundColor: C.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: 'rgba(246,196,78,0.14)',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 8,
  },
  // Landscape / fullscreen side panel
  sidePanel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 340,
    maxWidth: '55%',
    backgroundColor: C.bg,
    borderLeftWidth: 1,
    borderColor: 'rgba(246,196,78,0.14)',
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerText: {
    flex: 1,
  },
  headerLabel: {
    fontSize: 9,
    letterSpacing: 1,
    color: C.gold,
    fontFamily: 'Sora_700Bold',
    marginBottom: 2,
  },
  headerTopic: {
    fontSize: 14,
    color: C.text,
    fontFamily: 'Sora_600SemiBold',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,107,138,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  input: {
    flex: 1,
    marginTop: 12,
    marginBottom: 8,
    padding: 12,
    minHeight: 120,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    color: C.text,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Sora_400Regular',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  wordCount: {
    fontSize: 11,
    color: C.faint,
    fontFamily: 'JetBrainsMono_400Regular',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Sora_400Regular',
  },
  retryBtn: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.rose,
  },
  retryText: {
    fontSize: 11,
    color: C.rose,
    fontFamily: 'Sora_600SemiBold',
  },
  disabledBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 14,
  },
  disabledText: {
    fontSize: 13,
    color: C.muted,
    fontFamily: 'Sora_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
