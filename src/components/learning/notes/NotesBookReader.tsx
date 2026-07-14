/**
 * NotesBookReader — the primary AI Study Notes reading surface.
 *
 * Responsibilities:
 * - Loads notes via useTopicNotes
 * - Selects book reader (default) or card reader (legacy pref via AsyncStorage)
 * - Renders topic title, Contents button, Share button, page indicator, Prev/Next buttons
 * - Delegates page rendering to AnimatedBookPager
 * - Handles loading, empty, and error states
 * - Manages PDF generation via expo-print + expo-sharing (graceful fallback)
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  AccessibilityInfo,
  Platform,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

import { useTopicNotes } from '../../../hooks/useTopicNotes';
import { NotePage } from '../../../types/topicNotes';
import { AnimatedBookPager, LayoutMode } from './AnimatedBookPager';
import { NotesContentsModal } from './NotesContentsModal';
import { NotesCardReader } from './NotesCardReader';
import { NotePage as NotePageComponent } from './NotePage';
import { colors, spacing } from '../../../constants/theme';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEGACY_READER_KEY = 'notes.legacyReader';

// ---------------------------------------------------------------------------
// Layout helper
// ---------------------------------------------------------------------------

function getLayoutMode(width: number): LayoutMode {
  if (width >= 1024) return 'spread';
  if (width >= 768) return 'tablet';
  return 'phone';
}

// ---------------------------------------------------------------------------
// PDF generation (graceful: tries expo-print, falls back if unavailable)
// ---------------------------------------------------------------------------

async function generateAndSharePdf(
  pages: NotePage[],
  topicTitle: string,
): Promise<void> {
  // expo-print and expo-sharing are optional dependencies.
  // We guard with try/require so Metro doesn't fail at bundle time.
  let Print: any = null;
  let Sharing: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Print = require('expo-print');
  } catch (_) { /* not installed */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sharing = require('expo-sharing');
  } catch (_) { /* not installed */ }

  if (!Print || !Sharing) {
    Alert.alert(
      'PDF Export Unavailable',
      'PDF export requires expo-print and expo-sharing. Run:\n\nnpx expo install expo-print expo-sharing\n\nthen rebuild.',
    );
    return;
  }

  try {
    const html = buildPrintHtml(pages, topicTitle);
    const { uri } = await Print.printToFileAsync({ html });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Share ${topicTitle} Notes`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Sharing unavailable', 'PDF was generated but sharing is not available on this device.');
    }
  } catch (err) {
    Alert.alert(
      'PDF Export Failed',
      err instanceof Error ? err.message : 'An error occurred while generating the PDF.',
    );
  }
}

function buildPrintHtml(pages: NotePage[], title: string): string {
  const pageHtml = pages
    .map((page) => {
      const calloutsHtml = page.callouts
        .map((c) => `<div class="callout callout-${c.type}"><strong>${c.type}:</strong> ${c.text}</div>`)
        .join('');
      const bulletsHtml =
        page.bullets.length > 0
          ? `<ul>${page.bullets.map((b) => `<li>${b.text}</li>`).join('')}</ul>`
          : '';
      const imagesHtml = page.images
        .map((img) => `<img src="${img.url}" style="max-width:100%;height:auto;margin:8px 0;" />`)
        .join('');
      const qHtml = [
        ...page.questions.important.map((q) => `<p class="q important">★ ${q.question_text}</p>`),
        ...page.questions.practice.map((q) => `<p class="q">${q.question_text}</p>`),
      ].join('');
      return `
        <div class="page">
          ${page.isFirstPageOfSection ? `<h2>${page.sectionTitle}</h2>` : `<h3>${page.sectionTitle} (continued)</h3>`}
          ${calloutsHtml}
          ${page.prose ? `<p>${page.prose.replace(/\n\n/g, '</p><p>')}</p>` : ''}
          ${bulletsHtml}
          ${imagesHtml}
          ${qHtml}
        </div>`;
    })
    .join('<hr/>');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>${title}</title>
    <style>
      body { font-family: Georgia, serif; font-size: 14px; color: #1F2937; padding: 24px; max-width: 800px; margin: auto; }
      h1 { font-size: 22px; margin-bottom: 4px; }
      h2 { font-size: 18px; color: #111827; margin-top: 24px; margin-bottom: 8px; }
      h3 { font-size: 14px; color: #6B7280; font-style: italic; }
      p { line-height: 1.7; margin-bottom: 10px; }
      ul { margin: 0 0 12px 20px; }
      li { line-height: 1.7; margin-bottom: 4px; }
      .callout { border-left: 3px solid #3B82F6; padding: 8px 12px; background: #EFF6FF; margin-bottom: 10px; border-radius: 4px; }
      .callout-formula { border-color: #8B5CF6; background: #F5F3FF; }
      .callout-equation { border-color: #10B981; background: #ECFDF5; }
      .q { background: #F9FAFB; border: 1px solid #E5E7EB; padding: 8px; border-radius: 4px; margin-bottom: 6px; }
      .q.important { background: #FFFBEB; border-color: #FBBF24; }
      hr { border: none; border-top: 1px solid #E5E7EB; margin: 24px 0; }
      .page { margin-bottom: 24px; }
    </style>
  </head><body>
    <h1>${title} — Study Notes</h1>
    ${pageHtml}
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface NotesBookReaderProps {
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  topicTitle?: string;
}

export function NotesBookReader({
  topicId,
  chapterId,
  subjectId,
  topicTitle,
}: NotesBookReaderProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [contentsVisible, setContentsVisible] = useState(false);
  const [legacyReader, setLegacyReader] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const { width } = Dimensions.get('window');
  const layoutMode = getLayoutMode(width);

  const {
    loading,
    pages,
    sectionTitles,
    sectionFirstPageIndexes,
    error,
    jobTitle,
    isEmpty,
    refetch,
    generatingSection,
    generateQuestions,
  } = useTopicNotes(topicId);

  // Load preferences
  useEffect(() => {
    AsyncStorage.getItem(LEGACY_READER_KEY)
      .then((v) => setLegacyReader(v === 'true'))
      .catch(() => {});
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReducedMotion)
      .catch(() => {});
  }, []);

  // Clamp page index to valid range when pages change
  useEffect(() => {
    if (pages.length > 0) {
      setPageIndex((i) => Math.min(Math.max(i, 0), pages.length - 1));
    }
  }, [pages.length]);

  const safePageIndex = useMemo(
    () => Math.min(Math.max(pageIndex, 0), Math.max(pages.length - 1, 0)),
    [pageIndex, pages.length],
  );

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  const goNext = useCallback(() => {
    setPageIndex((i) => Math.min(i + 1, pages.length - 1));
  }, [pages.length]);

  const goPrev = useCallback(() => {
    setPageIndex((i) => Math.max(i - 1, 0));
  }, []);

  const jumpTo = useCallback((idx: number) => {
    setPageIndex(Math.min(Math.max(idx, 0), pages.length - 1));
  }, [pages.length]);

  // ---------------------------------------------------------------------------
  // PDF
  // ---------------------------------------------------------------------------

  const handleShare = useCallback(async () => {
    if (pdfLoading || pages.length === 0) return;
    setPdfLoading(true);
    await generateAndSharePdf(pages, topicTitle ?? jobTitle ?? 'Study Notes');
    setPdfLoading(false);
  }, [pdfLoading, pages, topicTitle, jobTitle]);

  // ---------------------------------------------------------------------------
  // Page renderer for AnimatedBookPager
  // ---------------------------------------------------------------------------

  const renderPage = useCallback(
    (page: NotePage, _index: number) => (
      <NotePageComponent
        key={page.id}
        page={page}
        topicId={topicId}
        chapterId={chapterId}
        subjectId={subjectId}
        generatingSection={generatingSection}
        onGenerateQuestions={generateQuestions}
        scrollable
      />
    ),
    [topicId, chapterId, subjectId, generatingSection, generateQuestions],
  );

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={s.loadingText}>Loading study notes…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={s.emptyTitle}>Could not load notes</Text>
        <Text style={s.emptyBody}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={refetch}>
          <Text style={s.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isEmpty || pages.length === 0) {
    return (
      <View style={s.center}>
        <Ionicons name="document-text-outline" size={52} color={colors.gray300} />
        <Text style={s.emptyTitle}>No study notes yet</Text>
        <Text style={s.emptyBody}>
          Study notes are not available for this topic yet.
        </Text>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Full reader
  // ---------------------------------------------------------------------------

  const displayTitle = topicTitle ?? jobTitle ?? 'Study Notes';

  return (
    <View style={s.container}>
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <View style={s.topBar}>
        <TouchableOpacity
          style={s.topBarBtn}
          onPress={() => setContentsVisible(true)}
          accessibilityLabel="Open contents"
        >
          <Ionicons name="list-outline" size={18} color={colors.primary} />
          <Text style={s.topBarBtnText}>Contents</Text>
        </TouchableOpacity>

        <Text style={s.topBarTitle} numberOfLines={1}>
          {displayTitle}
        </Text>

        <TouchableOpacity
          style={s.topBarBtn}
          onPress={handleShare}
          disabled={pdfLoading}
          accessibilityLabel="Share as PDF"
        >
          {pdfLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="share-outline" size={18} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Page indicator ──────────────────────────────────────────── */}
      <View style={s.pageIndicator}>
        <Text
          style={s.pageIndicatorText}
          accessibilityLabel={`Page ${safePageIndex + 1} of ${pages.length}`}
        >
          {safePageIndex + 1} / {pages.length}
        </Text>
        <Text style={s.sectionIndicatorText} numberOfLines={1}>
          {pages[safePageIndex]?.sectionTitle ?? ''}
        </Text>
      </View>

      {/* ── Reader body ──────────────────────────────────────────────── */}
      <View style={s.readerBody}>
        {legacyReader ? (
          <NotesCardReader
            pages={pages}
            topicId={topicId}
            chapterId={chapterId}
            subjectId={subjectId}
            generatingSection={generatingSection}
            onGenerateQuestions={generateQuestions}
          />
        ) : (
          <AnimatedBookPager
            pages={pages}
            currentPageIndex={safePageIndex}
            onPageIndexChange={setPageIndex}
            renderPage={renderPage}
            layoutMode={layoutMode}
            reducedMotion={reducedMotion}
          />
        )}
      </View>

      {/* ── Navigation controls (hidden in legacy reader) ───────────── */}
      {!legacyReader && (
        <View style={s.navBar}>
          <TouchableOpacity
            style={[s.navBtn, safePageIndex === 0 && s.navBtnDisabled]}
            onPress={goPrev}
            disabled={safePageIndex === 0}
            accessibilityLabel="Previous page"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={safePageIndex === 0 ? colors.gray300 : colors.primary}
            />
            <Text
              style={[
                s.navBtnText,
                safePageIndex === 0 && s.navBtnTextDisabled,
              ]}
            >
              Previous
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.readerToggleBtn}
            onPress={() => {
              const next = !legacyReader;
              setLegacyReader(next);
              AsyncStorage.setItem(LEGACY_READER_KEY, String(next)).catch(() => {});
            }}
            accessibilityLabel={legacyReader ? 'Switch to book reader' : 'Switch to card reader'}
          >
            <Ionicons
              name={legacyReader ? 'book-outline' : 'albums-outline'}
              size={16}
              color={colors.textSecondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.navBtn,
              safePageIndex === pages.length - 1 && s.navBtnDisabled,
            ]}
            onPress={goNext}
            disabled={safePageIndex === pages.length - 1}
            accessibilityLabel="Next page"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              style={[
                s.navBtnText,
                safePageIndex === pages.length - 1 && s.navBtnTextDisabled,
              ]}
            >
              Next
            </Text>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={
                safePageIndex === pages.length - 1
                  ? colors.gray300
                  : colors.primary
              }
            />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Contents modal ───────────────────────────────────────────── */}
      <NotesContentsModal
        visible={contentsVisible}
        sectionTitles={sectionTitles}
        sectionFirstPageIndexes={sectionFirstPageIndexes}
        currentPageIndex={safePageIndex}
        totalPages={pages.length}
        onJump={jumpTo}
        onClose={() => setContentsVisible(false)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 21,
  },
  retryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  topBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
    paddingVertical: 6,
  },
  topBarBtnText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginHorizontal: 4,
  },

  pageIndicator: {
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pageIndicatorText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  sectionIndicatorText: {
    fontSize: 10,
    color: colors.textMuted,
    maxWidth: '80%',
  },

  readerBody: { flex: 1 },

  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 88,
  },
  navBtnDisabled: { opacity: 0.4 },
  navBtnText: { fontSize: 14, color: colors.primary, fontWeight: '600' },
  navBtnTextDisabled: { color: colors.gray300 },
  readerToggleBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
});
