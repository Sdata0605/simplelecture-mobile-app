import { shouldUseV4Player, DPHARMACY_COURSE_ID } from '../playerSelection';

describe('shouldUseV4Player', () => {
  it('enables the V4 player only for the D.Pharmacy course', () => {
    expect(shouldUseV4Player(DPHARMACY_COURSE_ID)).toBe(true);
  });

  it('keeps every other course on the existing player', () => {
    expect(shouldUseV4Player('some-other-course-id')).toBe(false);
    expect(shouldUseV4Player('')).toBe(false);
    expect(shouldUseV4Player(null)).toBe(false);
    expect(shouldUseV4Player(undefined)).toBe(false);
  });
});
