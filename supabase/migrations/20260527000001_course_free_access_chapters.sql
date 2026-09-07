-- Free preview chapters table
-- Stores which chapters of a course are accessible without purchase.
CREATE TABLE IF NOT EXISTS public.course_free_access_chapters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES public.popular_subjects(id) ON DELETE CASCADE,
  chapter_id  uuid NOT NULL REFERENCES public.subject_chapters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  UNIQUE (course_id, chapter_id)
);

CREATE INDEX IF NOT EXISTS idx_cfa_course
  ON public.course_free_access_chapters(course_id);

CREATE INDEX IF NOT EXISTS idx_cfa_course_subject
  ON public.course_free_access_chapters(course_id, subject_id);

-- RLS: anyone can read free chapter configuration; only admins write (via service role)
ALTER TABLE public.course_free_access_chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_select"
  ON public.course_free_access_chapters
  FOR SELECT
  USING (true);

-- Per-course quotas for the free preview feature
-- 0 = feature disabled for that tab; NULL would mean unlimited, but we use 0 as disabled default
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS free_preview_ai_limit     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_preview_doubts_limit integer NOT NULL DEFAULT 0;
