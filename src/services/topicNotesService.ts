/**
 * Data-fetching service for the AI Study Notes feature.
 *
 * All queries are read-only REST calls against existing Supabase tables.
 * No schema changes, no new tables, no service-role key.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY, getValidAccessToken } from './supabase';
import { TopicNoteSection } from '../types/topicNotes';

const BASE_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = await getValidAccessToken();
    if (token) {
      return { ...BASE_HEADERS, Authorization: `Bearer ${token}` };
    }
  } catch {
    // Gracefully fall back to anon key — published content is publicly readable.
  }
  return { ...BASE_HEADERS, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TopicNotesJob {
  id: string;
  document_name: string | null;
  presentation_json: {
    sections: TopicNoteSection[];
    [key: string]: unknown;
  } | null;
  created_at: string;
}

export interface NotesRawQuestion {
  id: string;
  question_text: string;
  is_important: boolean;
  subtopic_id: string | null;
  difficulty: string;
  explanation: string | null;
  options: Record<string, { text: string } | string> | null;
  correct_answer: string;
}

export interface SubtopicRow {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the latest published+completed AI lecture job for a topic.
 *
 * Uses an inner join through ai_assistant_documents.topic_id so that only jobs
 * belonging to the requested topic are returned.
 *
 * Query:
 *   video_generation_jobs
 *     JOIN ai_assistant_documents (inner) ON ai_assistant_documents.topic_id = :topicId
 *   WHERE is_published = true AND status = completed
 *   ORDER BY created_at DESC LIMIT 1
 */
export async function fetchTopicNotesJob(
  topicId: string,
): Promise<TopicNotesJob | null> {
  const h = await authHeaders();
  const url =
    `${SUPABASE_URL}/rest/v1/video_generation_jobs` +
    `?select=id,document_name,presentation_json,created_at,ai_assistant_documents!inner(topic_id)` +
    `&ai_assistant_documents.topic_id=eq.${encodeURIComponent(topicId)}` +
    `&is_published=eq.true` +
    `&status=eq.completed` +
    `&order=created_at.desc` +
    `&limit=1`;

  const res = await fetch(url, { headers: h });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || data.length === 0) return null;

  return data[0] as TopicNotesJob;
}

/**
 * Fetch up to 500 questions for a topic.
 *
 * Questions with subtopic_id are used for section-matching during bucketing.
 */
export async function fetchTopicQuestions(
  topicId: string,
): Promise<NotesRawQuestion[]> {
  const h = await authHeaders();
  const url =
    `${SUPABASE_URL}/rest/v1/questions` +
    `?select=id,question_text,is_important,subtopic_id,difficulty,explanation,options,correct_answer` +
    `&topic_id=eq.${encodeURIComponent(topicId)}` +
    `&order=created_at.asc` +
    `&limit=500`;

  const res = await fetch(url, { headers: h });
  if (!res.ok) return [];

  const data = await res.json().catch(() => null);
  return Array.isArray(data) ? (data as NotesRawQuestion[]) : [];
}

/**
 * Fetch subtopics for a topic (needed for question → section bucketing).
 *
 * If the subject_subtopics table does not exist or the query fails, returns [].
 */
export async function fetchTopicSubtopics(
  topicId: string,
): Promise<SubtopicRow[]> {
  const h = await authHeaders();
  const url =
    `${SUPABASE_URL}/rest/v1/subject_subtopics` +
    `?select=id,title` +
    `&topic_id=eq.${encodeURIComponent(topicId)}` +
    `&limit=200`;

  try {
    const res = await fetch(url, { headers: h });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data) ? (data as SubtopicRow[]) : [];
  } catch {
    return [];
  }
}

/**
 * Invoke the generate-topic-notes-questions Edge Function.
 *
 * The Edge Function owns all AI-provider keys and database insertions.
 * The mobile client only sends the topic/section context.
 */
export async function generateTopicNotesQuestions(params: {
  topic_id: string;
  chapter_id?: string;
  subject_id?: string;
  section_id?: string | number;
  section_title?: string;
  section_text?: string;
  key_points?: string[];
  count?: number;
}): Promise<{ success: boolean; error?: string }> {
  const h = await authHeaders();
  const body = {
    topic_id: params.topic_id,
    chapter_id: params.chapter_id,
    subject_id: params.subject_id,
    section_id: params.section_id,
    section_title: params.section_title,
    section_text: params.section_text,
    key_points: (params.key_points ?? []).slice(0, 20),
    count: params.count ?? 5,
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/generate-topic-notes-questions`,
      {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => 'Request failed');
      return { success: false, error: text };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}
