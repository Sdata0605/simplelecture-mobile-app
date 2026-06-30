/**
 * Utilities for cleaning up question text before display.
 *
 * Some MCQ questions arrive with the answer choices already listed inline in the
 * question text (e.g. "- (a) OH⁻  - (b) H⁺ ...") AND also as separate selectable
 * options. Showing both is redundant, so we strip the inline enumerated choices
 * from the question text — but only when they clearly match the actual options,
 * so legitimate question content is never removed.
 */

/** Pull plain text values out of any supported options shape. */
function extractOptionTexts(options: any): string[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((o) =>
      o && typeof o === 'object' ? String((o as any).text ?? '') : String(o ?? ''),
    );
  }
  if (typeof options === 'object') {
    return Object.values(options).map((v) =>
      v && typeof v === 'object' ? String((v as any).text ?? '') : String(v ?? ''),
    );
  }
  return [];
}

/** Reduce a string to comparable letters/numbers only (drops LaTeX, sub/superscripts, spaces, punctuation). */
function normalizeForMatch(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/\$/g, '')
    .replace(/\\[a-z]+/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// Matches a line that starts with an enumerated option label:
//   "- (a) ...", "(b) ...", "c) ...", "D. ...", "1) ..."
const OPTION_LINE_RE = /^\s*(?:[-*•]\s*)?(?:\(([a-zA-Z0-9])\)|([a-zA-Z0-9])[.)])\s+(.*)$/;

// A bare label line such as "Options:" or "Choose the correct option:".
const OPTION_HEADER_RE = /^\s*(options?|choose[^:]*|select[^:]*)\s*:?\s*$/i;

/**
 * Remove inline enumerated answer choices from an MCQ question's text.
 * Only lines whose content matches one of the provided option values are removed,
 * and only when at least two such lines are found (a real MCQ), so this is a no-op
 * for clean questions and non-MCQ questions.
 */
export function stripEmbeddedOptions(text: string | null | undefined, options?: any): string {
  if (!text) return '';

  const optionSet = new Set(
    extractOptionTexts(options).map(normalizeForMatch).filter(Boolean),
  );
  if (optionSet.size === 0) return text;

  const lines = text.split(/\r?\n/);
  const keep: boolean[] = lines.map(() => true);

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPTION_LINE_RE);
    if (!m) continue;
    const content = normalizeForMatch(m[3] ?? '');
    if (content && optionSet.has(content)) {
      keep[i] = false;
    }
  }

  const removedCount = keep.filter((k) => !k).length;
  if (removedCount < 2) return text;

  // Drop a trailing "Options:" header that directly precedes a removed block.
  for (let i = 0; i < lines.length - 1; i++) {
    if (keep[i] && !keep[i + 1] && OPTION_HEADER_RE.test(lines[i])) {
      keep[i] = false;
    }
  }

  const cleaned = lines
    .filter((_, i) => keep[i])
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || text;
}
