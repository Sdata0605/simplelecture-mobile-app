-- Study Timetable Tables
-- NOTE: Apply this migration manually via the Supabase dashboard SQL editor or CLI.
-- Run: supabase db push  OR  paste contents into the dashboard SQL editor.

-- ─── study_timetables ────────────────────────────────────────────────────────
-- One plan per student per course (or subject/chapter scope)
CREATE TABLE IF NOT EXISTS public.study_timetables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  subject_id   uuid REFERENCES public.popular_subjects(id) ON DELETE SET NULL,
  chapter_id   uuid REFERENCES public.subject_chapters(id) ON DELETE SET NULL,
  title        text NOT NULL DEFAULT 'Study Plan',
  mode         text NOT NULL DEFAULT 'manual' CHECK (mode IN ('ai_auto', 'manual')),
  deadline     date,
  daily_hours  jsonb,        -- { weekday: [{start,end}], saturday: [...], sunday: [...] }
  ai_meta      jsonb,        -- feasibility result, generation params
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_st_student      ON public.study_timetables(student_id);
CREATE INDEX IF NOT EXISTS idx_st_student_course ON public.study_timetables(student_id, course_id);

ALTER TABLE public.study_timetables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_own_timetables"
  ON public.study_timetables
  FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- ─── study_timetable_sessions ─────────────────────────────────────────────────
-- Individual study slots generated from a plan (or added manually)
CREATE TABLE IF NOT EXISTS public.study_timetable_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable_id    uuid NOT NULL REFERENCES public.study_timetables(id) ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  scheduled_at    timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  subject_id      uuid REFERENCES public.popular_subjects(id) ON DELETE SET NULL,
  chapter_id      uuid REFERENCES public.subject_chapters(id) ON DELETE SET NULL,
  topic_id        uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sts_student         ON public.study_timetable_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_sts_timetable       ON public.study_timetable_sessions(timetable_id);
CREATE INDEX IF NOT EXISTS idx_sts_scheduled_at    ON public.study_timetable_sessions(student_id, scheduled_at);

ALTER TABLE public.study_timetable_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_own_sessions"
  ON public.study_timetable_sessions
  FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- ─── self_tests ───────────────────────────────────────────────────────────────
-- Student-scheduled MCQ practice tests
CREATE TABLE IF NOT EXISTS public.self_tests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id        uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  subject_id       uuid REFERENCES public.popular_subjects(id) ON DELETE SET NULL,
  title            text NOT NULL,
  test_type        text NOT NULL DEFAULT 'topic' CHECK (test_type IN ('topic', 'chapter')),
  scope_ids        uuid[] NOT NULL DEFAULT '{}',  -- topic or chapter IDs
  scheduled_at     timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  question_count   integer NOT NULL DEFAULT 10,
  submitted_at     timestamptz,
  score            numeric(5,2),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stest_student      ON public.self_tests(student_id);
CREATE INDEX IF NOT EXISTS idx_stest_student_course ON public.self_tests(student_id, course_id);
CREATE INDEX IF NOT EXISTS idx_stest_scheduled    ON public.self_tests(student_id, scheduled_at);

ALTER TABLE public.self_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_own_self_tests"
  ON public.self_tests
  FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

-- ─── self_test_questions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.self_test_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  self_test_id  uuid NOT NULL REFERENCES public.self_tests(id) ON DELETE CASCADE,
  question_text text NOT NULL,
  options       jsonb NOT NULL,       -- { A: '...', B: '...', C: '...', D: '...' }
  correct_answer text NOT NULL,
  explanation   text,
  display_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stq_test ON public.self_test_questions(self_test_id);

ALTER TABLE public.self_test_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_own_stq"
  ON public.self_test_questions
  FOR SELECT
  USING (
    self_test_id IN (
      SELECT id FROM public.self_tests WHERE student_id = auth.uid()
    )
  );

-- ─── self_test_answers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.self_test_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  self_test_id uuid NOT NULL REFERENCES public.self_tests(id) ON DELETE CASCADE,
  question_id  uuid NOT NULL REFERENCES public.self_test_questions(id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chosen_answer text NOT NULL,
  is_correct   boolean,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sta_test    ON public.self_test_answers(self_test_id);
CREATE INDEX IF NOT EXISTS idx_sta_student ON public.self_test_answers(student_id);

ALTER TABLE public.self_test_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_own_sta"
  ON public.self_test_answers
  FOR ALL
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());
