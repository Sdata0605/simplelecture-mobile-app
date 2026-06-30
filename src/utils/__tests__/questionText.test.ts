import { stripEmbeddedOptions } from '../questionText';

describe('stripEmbeddedOptions', () => {
  it('returns empty string for nullish text', () => {
    expect(stripEmbeddedOptions(null)).toBe('');
    expect(stripEmbeddedOptions(undefined)).toBe('');
    expect(stripEmbeddedOptions('')).toBe('');
  });

  it('returns the text unchanged when there are no options', () => {
    const t = 'What is the pH of a neutral solution?';
    expect(stripEmbeddedOptions(t, [])).toBe(t);
    expect(stripEmbeddedOptions(t, undefined)).toBe(t);
  });

  it('removes inline (a)/(b) choices that match the options', () => {
    const text = 'What is the pH scale?\n(a) acidic\n(b) basic';
    const out = stripEmbeddedOptions(text, [{ text: 'acidic' }, { text: 'basic' }]);
    expect(out).toBe('What is the pH scale?');
  });

  it('works with options given as a plain string array', () => {
    const text = 'Pick one:\n(a) acidic\n(b) basic';
    const out = stripEmbeddedOptions(text, ['acidic', 'basic']);
    expect(out).toBe('Pick one:');
  });

  it('works with options given as an object map', () => {
    const text = 'Pick one:\na) acidic\nb) basic';
    const out = stripEmbeddedOptions(text, { A: 'acidic', B: 'basic' });
    expect(out).toBe('Pick one:');
  });

  it('does NOT strip when fewer than two lines match (not a real MCQ)', () => {
    const text = 'Define acid.\n(a) acidic\nExtra context line';
    // only one option line matches -> removedCount < 2 -> no-op
    expect(stripEmbeddedOptions(text, ['acidic', 'basic'])).toBe(text);
  });

  it('leaves legitimate content that merely looks like a label', () => {
    const text = 'Step (a) happens before step (b).';
    expect(stripEmbeddedOptions(text, ['acidic', 'basic'])).toBe(text);
  });

  it('also drops a trailing "Options:" header above a removed block', () => {
    const text = 'Choose the strong acid.\nOptions:\n(a) acidic\n(b) basic';
    const out = stripEmbeddedOptions(text, ['acidic', 'basic']);
    expect(out).toBe('Choose the strong acid.');
  });

  it('matches different label punctuation (A. / 1) / bullet)', () => {
    const text = 'Q\n- (a) acidic\nB. basic';
    expect(stripEmbeddedOptions(text, ['acidic', 'basic'])).toBe('Q');
  });

  it('ignores case and surrounding punctuation/LaTeX when matching', () => {
    const text = 'Q\n(a) $ACIDIC$\n(b) Basic!';
    expect(stripEmbeddedOptions(text, ['acidic', 'basic'])).toBe('Q');
  });
});
