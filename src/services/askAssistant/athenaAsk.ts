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
import { askLog, askWarn, preview } from './askLog';

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

/** react-native-sse's own connection-level events, useful for telling "never
 * connected" apart from "connected but no frames parsed". */
type SSELifecycleEvent = 'open' | 'close';

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
  const body = JSON.stringify({
    question: params.question,
    subjectId: params.subjectId,
    chapterId: params.chapterId,
    topicId: params.topicId,
  });

  askLog('sse', `POST /ask subject=${params.subjectId} topic=${params.topicId ?? '-'}`);
  askLog('sse', `question: ${preview(params.question)}`);

  const es = new EventSource<AthenaSSEEventName | SSELifecycleEvent>(proxyUrl('/ask'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    // Athena/the proxy send CRLF line endings, not bare LF (same quirk the
    // web client works around by normalizing before parsing). Verified again
    // 2026-10-09 by hexdumping the proxy's response: frames end `\r\n\r\n`.
    lineEndingCharacter: '\r\n',
    pollingInterval: 0,
  });

  let ended = false;
  let eventCount = 0;
  const seen: Record<string, number> = {};

  const finish = () => {
    if (ended) return;
    ended = true;
    askLog('sse', `closing after ${eventCount} event(s)`, seen);
    es.removeAllEventListeners();
    es.close();
    onEnd();
  };

  /** Logs every frame before handing it on, so a stream that connects but
   * never produces a `done` shows exactly what it did produce. */
  const trace = (name: string, raw?: string | null) => {
    eventCount += 1;
    seen[name] = (seen[name] ?? 0) + 1;
    askLog('sse', `<- ${name}${raw ? ` ${preview(raw)}` : ''}`);
  };

  es.addEventListener('open', () => askLog('sse', 'connection open'));
  es.addEventListener('close', () => askLog('sse', 'connection closed by server'));

  const parse = (raw: string | null | undefined): any => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  es.addEventListener('thinking', (ev) => {
    trace('thinking', (ev as { data?: string | null }).data);
    onEvent({ type: 'thinking' });
  });

  es.addEventListener('meta', (ev) => {
    trace('meta', ev.data);
    const data = parse(ev.data);
    if (!data) {
      askWarn('sse', 'meta payload did not parse — answer_id unknown');
      return;
    }
    askLog(
      'sse',
      `meta answer_id=${data.answer_id} hf_enabled=${!!data.hf_enabled} cached=${!!data.cached}`,
    );
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
    if (!data) {
      trace('segment');
      askWarn('sse', 'segment payload did not parse — dropped');
      return;
    }
    trace('segment');
    askLog('sse', `segment i=${data.i} type=${data.type ?? '-'} title=${preview(data.title ?? '', 40)}`);
    onEvent({ type: 'segment', segment: data as AthenaSegment });
  });

  es.addEventListener('done', (ev) => {
    trace('done', ev.data);
    const data = parse(ev.data);
    if (!data?.answer_id) {
      askWarn('sse', 'done event carried no answer_id — the hook will fall back to meta');
    }
    onEvent({
      type: 'done',
      answerId: data?.answer_id,
      sources: Array.isArray(data?.source_documents) ? data.source_documents : [],
    });
    finish();
  });

  es.addEventListener('out_of_scope', (ev) => {
    trace('out_of_scope', ev.data);
    const data = parse(ev.data);
    onEvent({ type: 'out_of_scope', message: data?.message });
    finish();
  });

  es.addEventListener('error', (ev) => {
    // This library fires its own connection-level "error" events on the same
    // name as Athena's content-level "error" SSE event — disambiguate by
    // whether there's a parseable payload.
    const raw = ev as { data?: string | null; message?: string; xhrStatus?: number; xhrState?: number };
    const data = parse(raw.data);
    const message = data?.message || data?.error || 'Connection error';
    trace('error', raw.data);
    askWarn(
      'sse',
      `error: ${message} (transport message=${raw.message ?? '-'} xhrStatus=${raw.xhrStatus ?? '-'} xhrState=${raw.xhrState ?? '-'})`,
    );
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
