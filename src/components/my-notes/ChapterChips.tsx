import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius, fontFamily } from '../../constants/theme';

/**
 * Horizontally scrollable chapter selector used in the Chapter Notebook screen.
 */

export interface ChapterChipItem {
  id: string;
  chapter_number: number | null;
  title: string;
}

interface ChapterChipsProps {
  chapters: ChapterChipItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ChapterChips({ chapters, selectedId, onSelect }: ChapterChipsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID="chapter-chips"
    >
      {chapters.map((ch) => {
        const active = ch.id === selectedId;
        return (
          <TouchableOpacity
            key={ch.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(ch.id)}
            activeOpacity={0.8}
            testID={`chapter-chip-${ch.id}`}
          >
            <Text style={[styles.chipNum, active && styles.chipTextActive]}>{ch.chapter_number ?? '•'}</Text>
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
              numberOfLines={1}
            >
              {ch.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray100,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipNum: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: fontSize.sm,
    color: colors.text,
    flexShrink: 1,
  },
  chipTextActive: {
    color: colors.white,
  },
});
