/**
 * NotesCardReader — legacy card-based reader.
 *
 * Each presentation section is shown as a collapsible card with:
 * - Section title + type badge
 * - Narration prose (collapsible)
 * - Callouts (definition / formula / equation)
 * - Bullets / key points
 * - Images
 * - Important and practice questions
 * - Generate Practice Questions button
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { NotePage, NotesBulletItem, NotesCallout } from '../../../types/topicNotes';
import { colors, spacing, borderRadius } from '../../../constants/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectionGroup {
  sectionId: string;
  sectionTitle: string;
  sectionType: string;
  pages: NotePage[];
  allProse: string;
  allCallouts: NotesCallout[];
  allBullets: NotesBulletItem[];
  images: { url: string }[];
  importantQuestions: NotePage['questions']['important'];
  practiceQuestions: NotePage['questions']['practice'];
}

interface Props {
  pages: NotePage[];
  topicId?: string;
  chapterId?: string;
  subjectId?: string;
  generatingSection: string | null;
  onGenerateQuestions: (params: {
    sectionId: string | number;
    sectionTitle: string;
    sectionText: string;
    keyPoints: string[];
    chapterId?: string;
    subjectId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupPagesIntoSections(pages: NotePage[]): SectionGroup[] {
  const map = new Map<string, SectionGroup>();
  const order: string[] = [];

  for (const page of pages) {
    if (!map.has(page.sectionId)) {
      map.set(page.sectionId, {
        sectionId: page.sectionId,
        sectionTitle: page.sectionTitle,
        sectionType: page.sectionType,
        pages: [],
        allProse: '',
        allCallouts: [],
        allBullets: [],
        images: [],
        importantQuestions: [],
        practiceQuestions: [],
      });
      order.push(page.sectionId);
    }
    const group = map.get(page.sectionId)!;
    group.pages.push(page);
    if (page.prose) {
      group.allProse = group.allProse
        ? `${group.allProse}\n\n${page.prose}`
        : page.prose;
    }
    group.allCallouts.push(...page.callouts);
    group.allBullets.push(...page.bullets);
    group.images.push(...page.images);
    group.importantQuestions.push(...page.questions.important);
    group.practiceQuestions.push(...page.questions.practice);
  }

  return order.map((id) => map.get(id)!);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  group,
  chapterId,
  subjectId,
  generatingSection,
  onGenerateQuestions,
}: {
  group: SectionGroup;
  chapterId?: string;
  subjectId?: string;
  generatingSection: string | null;
  onGenerateQuestions: Props['onGenerateQuestions'];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const isGenerating = generatingSection === group.sectionId;
  const showGenerate = group.practiceQuestions.length < 3;

  const handleGenerate = useCallback(async () => {
    setGenerateError(null);
    const result = await onGenerateQuestions({
      sectionId: group.sectionId,
      sectionTitle: group.sectionTitle,
      sectionText: group.allProse,
      keyPoints: group.allBullets.map((b) => b.text),
      chapterId,
      subjectId,
    });
    if (!result.success) setGenerateError(result.error ?? 'Failed');
  }, [group, chapterId, subjectId, onGenerateQuestions]);

  return (
    <View style={s.card}>
      {/* Card header */}
      <TouchableOpacity
        style={s.cardHeader}
        onPress={() => setCollapsed((c) => !c)}
        activeOpacity={0.7}
        accessibilityLabel={collapsed ? `Expand ${group.sectionTitle}` : `Collapse ${group.sectionTitle}`}
      >
        <View style={s.cardTitleRow}>
          {group.sectionType && group.sectionType !== 'content' && (
            <View style={s.typeBadge}>
              <Text style={s.typeBadgeText}>{group.sectionType}</Text>
            </View>
          )}
          <Text style={s.cardTitle} numberOfLines={collapsed ? 1 : 3}>
            {group.sectionTitle}
          </Text>
        </View>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {!collapsed && (
        <View style={s.cardBody}>
          {/* Callouts */}
          {group.allCallouts.map((c, i) => (
            <View
              key={i}
              style={[s.callout, { borderLeftColor: calloutColor(c.type) }]}
            >
              <Text style={[s.calloutType, { color: calloutColor(c.type) }]}>
                {c.type.charAt(0).toUpperCase() + c.type.slice(1)}
              </Text>
              <Text style={s.calloutText}>{c.text}</Text>
            </View>
          ))}

          {/* Prose */}
          {!!group.allProse && (
            <Text style={s.prose}>{group.allProse}</Text>
          )}

          {/* Bullets */}
          {group.allBullets.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Key Points</Text>
              {group.allBullets.map((b, i) => (
                <View key={i} style={s.bulletRow}>
                  <Text style={s.bulletDot}>•</Text>
                  <Text style={s.bulletText}>{b.text}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Images */}
          {group.images.length > 0 && (
            <View style={s.section}>
              {group.images.map((img, i) => (
                <SafeImage key={i} url={img.url} />
              ))}
            </View>
          )}

          {/* Important questions */}
          {group.importantQuestions.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Important Questions</Text>
              {group.importantQuestions.map((q) => (
                <QuestionTile key={q.id} question={q} isImportant />
              ))}
            </View>
          )}

          {/* Practice questions */}
          {group.practiceQuestions.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionLabel}>Practice Questions</Text>
              {group.practiceQuestions.map((q) => (
                <QuestionTile key={q.id} question={q} isImportant={false} />
              ))}
            </View>
          )}

          {/* Generate button */}
          {showGenerate && (
            <View style={s.generateRow}>
              <TouchableOpacity
                style={[s.generateBtn, isGenerating && s.generateBtnDisabled]}
                onPress={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Ionicons name="sparkles-outline" size={14} color={colors.white} />
                )}
                <Text style={s.generateBtnText}>
                  {isGenerating ? 'Generating…' : 'Generate Practice Questions'}
                </Text>
              </TouchableOpacity>
              {!!generateError && (
                <Text style={s.generateError}>{generateError}</Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function calloutColor(type: string): string {
  if (type === 'formula') return '#8B5CF6';
  if (type === 'equation') return '#10B981';
  return '#3B82F6';
}

function SafeImage({ url }: { url: string }) {
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

function QuestionTile({
  question,
  isImportant,
}: {
  question: NotePage['questions']['important'][0];
  isImportant: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity
      style={[s.qCard, isImportant && s.qCardImportant]}
      onPress={() => setExpanded((e) => !e)}
      activeOpacity={0.8}
    >
      {isImportant && (
        <View style={s.importantBadge}>
          <Ionicons name="star" size={9} color="#fff" />
          <Text style={s.importantBadgeText}>Important</Text>
        </View>
      )}
      <Text style={s.qText}>{question.question_text}</Text>
      {expanded && question.explanation ? (
        <Text style={s.qExplanation}>{question.explanation}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function NotesCardReader({
  pages,
  topicId,
  chapterId,
  subjectId,
  generatingSection,
  onGenerateQuestions,
}: Props) {
  const sections = groupPagesIntoSections(pages);

  if (sections.length === 0) return null;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
    >
      {sections.map((group) => (
        <SectionCard
          key={group.sectionId}
          group={group}
          chapterId={chapterId}
          subjectId={subjectId}
          generatingSection={generatingSection}
          onGenerateQuestions={onGenerateQuestions}
        />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 32 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    gap: 8,
  },
  cardTitleRow: { flex: 1, gap: 4 },
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardBody: { padding: spacing.md, paddingTop: 0 },

  prose: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  callout: {
    borderLeftWidth: 3,
    borderRadius: 4,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  calloutType: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  calloutText: { fontSize: 13, color: colors.text, lineHeight: 19 },

  section: { marginBottom: spacing.sm },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  bulletRow: { flexDirection: 'row', marginBottom: 3, paddingRight: 4 },
  bulletDot: { fontSize: 14, color: colors.primary, marginRight: 6, lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 21 },

  noteImage: {
    width: '100%',
    height: 160,
    borderRadius: 6,
    marginBottom: spacing.xs,
    backgroundColor: colors.gray100,
  },

  qCard: {
    backgroundColor: colors.surface,
    borderRadius: 6,
    padding: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qCardImportant: { borderColor: '#FBBF24', backgroundColor: '#FFFBEB' },
  importantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B',
    alignSelf: 'flex-start',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginBottom: 4,
    gap: 2,
  },
  importantBadgeText: { fontSize: 8, fontWeight: '700', color: '#fff' },
  qText: { fontSize: 13, color: colors.text, lineHeight: 19 },
  qExplanation: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  generateRow: { marginTop: spacing.sm },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  generateBtnDisabled: { opacity: 0.65 },
  generateBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  generateError: { color: colors.error, fontSize: 12, marginTop: 4, textAlign: 'center' },
});
