/**
 * NotePage renders the content of a single study-note page:
 * prose, callouts (definition/formula/equation), bullets, images, questions.
 *
 * Receives a pre-built NotePage object — all parsing happened in notePagination.ts.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { NotePage as NotePageType } from '../../../types/topicNotes';
import { colors, spacing, fontSize, borderRadius } from '../../../constants/theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NotePageProps {
  page: NotePageType;
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  generatingSection?: string | null;
  onGenerateQuestions?: (params: {
    sectionId: string | number;
    sectionTitle: string;
    sectionText: string;
    keyPoints: string[];
    chapterId?: string;
    subjectId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onGenerateSuccess?: () => void;
  scrollable?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CalloutBlock({ type, text }: { type: string; text: string }) {
  const icon =
    type === 'definition'
      ? 'book-outline'
      : type === 'formula'
      ? 'calculator-outline'
      : 'flask-outline';

  const accent =
    type === 'definition'
      ? '#3B82F6'
      : type === 'formula'
      ? '#8B5CF6'
      : '#10B981';

  return (
    <View style={[s.callout, { borderLeftColor: accent }]}>
      <View style={s.calloutHeader}>
        <Ionicons name={icon as any} size={14} color={accent} />
        <Text style={[s.calloutType, { color: accent }]}>
          {type.charAt(0).toUpperCase() + type.slice(1)}
        </Text>
      </View>
      <Text style={s.calloutText}>{text}</Text>
    </View>
  );
}

function BulletItem({ text }: { text: string }) {
  return (
    <View style={s.bulletRow}>
      <Text style={s.bulletDot}>•</Text>
      <Text style={s.bulletText}>{text}</Text>
    </View>
  );
}

function NoteImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <Image
      source={{ uri: url }}
      style={s.noteImage}
      resizeMode="contain"
      onError={() => setFailed(true)}
    />
  );
}

function QuestionCard({
  question,
  isImportant,
}: {
  question: NotePageType['questions']['important'][0];
  isImportant: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[s.qCard, isImportant && s.qCardImportant]}
      onPress={() => setExpanded((e) => !e)}
      accessibilityLabel={question.question_text}
    >
      {isImportant && (
        <View style={s.importantBadge}>
          <Ionicons name="star" size={10} color="#fff" />
          <Text style={s.importantBadgeText}>Important</Text>
        </View>
      )}
      <Text style={s.qText}>{question.question_text}</Text>
      {expanded && question.explanation ? (
        <Text style={s.qExplanation}>{question.explanation}</Text>
      ) : null}
      {!expanded && question.explanation ? (
        <Text style={s.qHint}>Tap for explanation</Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotePage({
  page,
  topicId,
  chapterId,
  subjectId,
  generatingSection,
  onGenerateQuestions,
  scrollable = true,
}: NotePageProps) {
  const [generateError, setGenerateError] = useState<string | null>(null);
  const isGenerating = generatingSection === page.sectionId;
  const practiceCount = page.questions.practice.length;
  const showGenerateBtn =
    page.isLastPageOfSection &&
    practiceCount < 3 &&
    !!onGenerateQuestions;

  const keyPoints = page.bullets.map((b) => b.text);

  async function handleGenerate() {
    if (!onGenerateQuestions) return;
    setGenerateError(null);
    const result = await onGenerateQuestions({
      sectionId: page.sectionId,
      sectionTitle: page.sectionTitle,
      sectionText: page.prose,
      keyPoints,
      chapterId,
      subjectId,
    });
    if (!result.success) {
      setGenerateError(result.error ?? 'Failed to generate questions');
    }
  }

  const content = (
    <View style={s.container}>
      {/* Section title on the first page */}
      {page.isFirstPageOfSection && (
        <View style={s.sectionHeader}>
          {page.sectionType && page.sectionType !== 'content' && (
            <View style={s.typeBadge}>
              <Text style={s.typeBadgeText}>{page.sectionType}</Text>
            </View>
          )}
          <Text style={s.sectionTitle}>{page.sectionTitle}</Text>
        </View>
      )}

      {/* "Continued" indicator for mid-section pages */}
      {!page.isFirstPageOfSection && page.totalPagesInSection > 1 && (
        <Text style={s.continued}>{page.sectionTitle} (continued)</Text>
      )}

      {/* Callouts — first page only */}
      {page.callouts.map((c, i) => (
        <CalloutBlock key={`callout-${i}`} type={c.type} text={c.text} />
      ))}

      {/* Prose */}
      {!!page.prose && <Text style={s.prose}>{page.prose}</Text>}

      {/* Bullets — last page only */}
      {page.bullets.length > 0 && (
        <View style={s.bulletSection}>
          <Text style={s.sectionSubLabel}>Key Points</Text>
          {page.bullets.map((b, i) => (
            <BulletItem key={`bullet-${i}`} text={b.text} />
          ))}
        </View>
      )}

      {/* Images — last page only */}
      {page.images.length > 0 && (
        <View style={s.imageSection}>
          {page.images.map((img, i) => (
            <NoteImage key={`img-${i}`} url={img.url} />
          ))}
        </View>
      )}

      {/* Questions — last page only */}
      {(page.questions.important.length > 0 ||
        page.questions.practice.length > 0) && (
        <View style={s.questionsSection}>
          {page.questions.important.length > 0 && (
            <>
              <Text style={s.sectionSubLabel}>Important Questions</Text>
              {page.questions.important.map((q) => (
                <QuestionCard key={q.id} question={q} isImportant />
              ))}
            </>
          )}
          {page.questions.practice.length > 0 && (
            <>
              <Text style={s.sectionSubLabel}>Practice Questions</Text>
              {page.questions.practice.map((q) => (
                <QuestionCard key={q.id} question={q} isImportant={false} />
              ))}
            </>
          )}
        </View>
      )}

      {/* Generate practice questions button */}
      {showGenerateBtn && (
        <View style={s.generateSection}>
          <TouchableOpacity
            style={[s.generateBtn, isGenerating && s.generateBtnDisabled]}
            onPress={handleGenerate}
            disabled={isGenerating}
            accessibilityLabel="Generate practice questions"
          >
            {isGenerating ? (
              <>
                <ActivityIndicator size="small" color={colors.white} />
                <Text style={s.generateBtnText}>Generating…</Text>
              </>
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={16} color={colors.white} />
                <Text style={s.generateBtnText}>Generate Practice Questions</Text>
              </>
            )}
          </TouchableOpacity>
          {!!generateError && (
            <Text style={s.generateError}>{generateError}</Text>
          )}
        </View>
      )}
    </View>
  );

  if (scrollable) {
    return <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>{content}</ScrollView>;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  container: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  // Section header
  sectionHeader: { marginBottom: spacing.sm },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary + '22',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius?.sm ?? 4,
    marginBottom: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
  continued: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.xs,
  },

  // Prose
  prose: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.text,
    marginBottom: spacing.sm,
  },

  // Callouts
  callout: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: 6,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  calloutHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  calloutType: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  calloutText: { fontSize: 14, color: colors.text, lineHeight: 20 },

  // Bullets
  bulletSection: { marginBottom: spacing.sm },
  sectionSubLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  bulletRow: { flexDirection: 'row', marginBottom: 4, paddingRight: 8 },
  bulletDot: {
    fontSize: 15,
    color: colors.primary,
    marginRight: 6,
    lineHeight: 22,
  },
  bulletText: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 22 },

  // Images
  imageSection: { marginBottom: spacing.sm },
  noteImage: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginBottom: spacing.xs,
    backgroundColor: colors.gray100,
  },

  // Questions
  questionsSection: { marginBottom: spacing.sm },
  qCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qCardImportant: {
    borderColor: '#FBBF24',
    backgroundColor: '#FFFBEB',
  },
  importantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginBottom: 6,
    gap: 3,
  },
  importantBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  qText: { fontSize: 13, color: colors.text, lineHeight: 20 },
  qExplanation: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  qHint: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: 'italic' },

  // Generate questions
  generateSection: { marginTop: spacing.sm },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  generateBtnDisabled: { opacity: 0.65 },
  generateBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  generateError: {
    color: colors.error,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
});
