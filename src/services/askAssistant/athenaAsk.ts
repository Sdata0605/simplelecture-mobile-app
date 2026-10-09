// Client for Athena's /ask (SSE) and /answers/{id}/video (HyperFrame
// readiness poll) — ported from the web app's src/lib/api/athenaAsk.ts.
// Same athena-proxy Supabase Edge Function, same project, confirmed live
// (2026-10-06) to need no auth headers (verify_jwt=false on the function,
// matching web's own un-authenticated fetch).
//
// Web parses the stream manually via fetch's readable body
// (`response.body.getReader()`), which React Native's `fetch` doesn't
// support uniformly across platforms. This uses `react-native-sse`'s
// EventSource instead, which gets the same incremental, named-event
// delivery over XHR progressive reads.
import EventSource from 'react-native-sse';
import { SUPABASE_DIRECT_URL } from '../supabase';

const ATHENA_BASE = 'http://116.202.230.124:8090';
const PROXY_URL = `${SUPABASE_DIRECT_URL}/functions/v1/athena-proxy`;

function proxyUrl(path: string, extra?: Record<string, string>) {
  const search = new URLSearchParams({ path, base: ATHENA_BASE, ...extra });
  return `${PROXY_URL}?${search.toString()}`;
}

/** Full, fetchable URL for a HyperFrame html_paths/audio_* relative path. */
export function resolveHyperframeAssetUrl(answerId: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return proxyUrl(`/storage/answers/${answerId}/${clean}`);
}

export interface AthenaWordTiming {
  w: string;
  s: number;
  e: number;
}

export interface AthenaSegment {
  i: number;
  type?: string;
  title?: string;
  html?: string;
  plain?: string;
  t_start?: number;
  t_end?: number;
  tokens?: AthenaWordTiming[];
  cite?: number[];
  visual?: { renderer?: string; latex?: string };
}

export interface AthenaSource {
  document_id: string;
  title: string;
  section?: string;
}

export interface AthenaAskMeta {
  answer_id: string;
  hf_enabled: boolean;
  cached: boolean;
  sources: AthenaSource[];
}

export type AthenaAskEvent =
  | { type: 'thinking' }
  | { type: 'meta'; meta: AthenaAskMeta }
  | { type: 'segment'; segment: AthenaSegment }
  | { type: 'done'; answerId: string; sources: AthenaSource[] }
  | { type: 'out_of_scope'; message?: string }
  | { type: 'error'; message: string };

export interface AskAthenaParams {
  question: string;
  subjectId: string;
  chapterId?: string;
  topicId?: string;
}

export interface AskAthenaHandle {
  /** Close the connection early (e.g. the student closed the assistant). */
  close: () => void;
}

type AthenaSSEEventName = 'thinking' | 'meta' | 'segment' | 'done' | 'out_of_scope' | 'error';

/**
 * Streams /ask, calling `onEvent` for each SSE message as it arrives, and
 * `onEnd` once the stream closes (after `done`/`out_of_scope`, a connection
 * error, or an explicit `close()`). Mirrors the web function's event
 * semantics; callers read final state from the events they received.
 */
export function askAthenaQuestion(
  params: AskAthenaParams,
  onEvent: (event: AthenaAskEvent) => void,
  onEnd: () => void,
): AskAthenaHandle {
  const es = new EventSource<AthenaSSEEventName>(proxyUrl('/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: params.question,
      subjectId: params.subjectId,
      chapterId: params.chapterId,
      topicId: params.topicId,
    }),
    // Athena/the proxy send CRLF line endings, not bare LF (same quirk the
    // web client works around by normalizing before parsing).
    lineEndingCharacter: '\r\n',
    pollingInterval: 0,
  });

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    es.removeAllEventListeners();
    es.close();
    onEnd();
  };

  const parse = (raw: string | null | undefined): any => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  es.addEventListener('thinking', () => onEvent({ type: 'thinking' }));

  es.addEventListener('meta', (ev) => {
    const data = parse(ev.data);
    if (!data) return;
    onEvent({
      type: 'meta',
      meta: {
        answer_id: data.answer_id,
        hf_enabled: !!data.hf_enabled,
        cached: !!data.cached,
        sources: Array.isArray(data.sources) ? data.sources : [],
      },
    });
  });

  es.addEventListener('segment', (ev) => {
    const data = parse(ev.data);
    if (!data) return;
    onEvent({ type: 'segment', segment: data as AthenaSegment });
  });

  es.addEventListener('done', (ev) => {
    const data = parse(ev.data);
    onEvent({
      type: 'done',
      answerId: data?.answer_id,
      sources: Array.isArray(data?.source_documents) ? data.source_documents : [],
    });
    finish();
  });

  es.addEventListener('out_of_scope', (ev) => {
    const data = parse(ev.data);
    onEvent({ type: 'out_of_scope', message: data?.message });
    finish();
  });

  es.addEventListener('error', (ev) => {
    // This library fires its own connection-level "error" events on the same
    // name as Athena's content-level "error" SSE event — disambiguate by
    // whether there's a parseable payload.
    const data = parse((ev as { data?: string | null }).data);
    const message = data?.message || data?.error || 'Connection error';
    onEvent({ type: 'error', message });
    finish();
  });

  return { close: finish };
}

export interface HyperframeVideoStatus {
  ready: boolean | null;
  html_paths: string[];
  audio_female: string[];
  audio_male: string[];
}

export async function pollHyperframeVideo(answerId: string): Promise<HyperframeVideoStatus> {
  const res = await fetch(proxyUrl(`/answers/${encodeURIComponent(answerId)}/video`));
  if (!res.ok) throw new Error(`Video status request failed (${res.status})`);
  const data = await res.json();
  return {
    ready: data.ready ?? null,
    html_paths: Array.isArray(data.html_paths) ? data.html_paths : [],
    audio_female: Array.isArray(data.audio_female) ? data.audio_female : [],
    audio_male: Array.isArray(data.audio_male) ? data.audio_male : [],
  };
}
