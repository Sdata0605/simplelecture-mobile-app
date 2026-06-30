// Player selection logic for AI lectures.
// V4 player is enabled ONLY for the D.Pharmacy course; all other courses keep
// their existing player. This gates the new self-contained V4 player so it can
// be rolled out one course at a time.

export const DPHARMACY_COURSE_ID = 'e74e8e53-5949-4113-a565-1e84c2b4ee0e';

export function shouldUseV4Player(courseId?: string | null): boolean {
  return courseId === DPHARMACY_COURSE_ID;
}
