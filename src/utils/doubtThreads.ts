/**
 * Doubt thread store — ChatGPT-style conversation history for the Doubts tab.
 *
 * Threads are per-device and per-subject:
 *   primary key : `doubts-threads:<subjectId>` → JSON DoubtThread[]
 *   legacy key  : `doubts-chat:<subjectId>`    → older flat message[] (migrated
 *                 once into a single thread, then the legacy key is deleted)
 *
 * Pure helpers (title generation, relative time, sorting, capping, sanitizing)
 * are exported separately from the AsyncStorage load/save functions so they
 * can be unit-tested without a storage mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface DoubtStoredMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Follow-up prompt chips; only the newest assistant message keeps them. */
  suggestions?: string[];
}

export interface DoubtThread {
  id: string;
  title: string;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms; bumped on every message append
  messages: DoubtStoredMessage[]; // capped at last MAX_THREAD_MESSAGES on save
}

export const PLACEHOLDER_TITLE = 'New doubt';
export const MAX_THREAD_MESSAGES = 30;
export const MAX_TITLE_LENGTH = 60;

const threadsKey = (subjectId: string) => `doubts-threads:${subjectId}`;
const legacyKey = (subjectId: string) => `doubts-chat:${subjectId}`;

/** Fresh id: crypto.randomUUID when available, else `t_<timestamp>_<rand>`. */
export function generateThreadId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // fall through to manual id
    }
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createThread(now: number = Date.now()): DoubtThread {
  return {
    id: generateThreadId(),
    title: PLACEHOLDER_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/**
 * Title from the first user message: trimmed, whitespace collapsed,
 * capped at 60 chars (57 + "…" when longer). Null when no user message.
 */
export function titleFromMessages(messages: DoubtStoredMessage[]): string | null {
  const first = messages.find((m) => m && m.role === 'user' && typeof m.content === 'string');
  if (!first) return null;
  const collapsed = first.content.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= MAX_TITLE_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_TITLE_LENGTH - 3)}…`;
}

/** Placeholder titles get auto-replaced; real titles are never overwritten. */
export function deriveTitle(currentTitle: string, messages: DoubtStoredMessage[]): string {
  if (currentTitle && currentTitle !== PLACEHOLDER_TITLE) return currentTitle;
  return titleFromMessages(messages) ?? PLACEHOLDER_TITLE;
}

/** "just now" / "Xm ago" / "Xh ago" / "Xd ago", locale date after 7 days. */
export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - epochMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

/** Most recently active first. Returns a new array; input is not mutated. */
export function sortThreads(threads: DoubtThread[]): DoubtThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function sanitizeMessage(raw: any): DoubtStoredMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.role !== 'user' && raw.role !== 'assistant') return null;
  if (typeof raw.content !== 'string') return null;
  const msg: DoubtStoredMessage = { role: raw.role, content: raw.content };
  if (Array.isArray(raw.suggestions)) {
    const chips = raw.suggestions
      .map((s: any) => (typeof s === 'string' ? s : s && typeof s.text === 'string' ? s.text : null))
      .filter((s: any): s is string => !!s && !!s.trim());
    if (chips.length > 0) msg.suggestions = chips;
  }
  return msg;
}

/** Validate arbitrary parsed JSON into a safe DoubtThread[]. Drops garbage. */
export function sanitizeThreads(raw: any): DoubtThread[] {
  if (!Array.isArray(raw)) return [];
  const out: DoubtThread[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.id !== 'string' || !t.id) continue;
    const messages = Array.isArray(t.messages)
      ? (t.messages.map(sanitizeMessage).filter(Boolean) as DoubtStoredMessage[])
      : [];
    const createdAt = typeof t.createdAt === 'number' && isFinite(t.createdAt) ? t.createdAt : 0;
    const updatedAt =
      typeof t.updatedAt === 'number' && isFinite(t.updatedAt) ? t.updatedAt : createdAt;
    const title =
      typeof t.title === 'string' && t.title.trim() ? t.title : deriveTitle(PLACEHOLDER_TITLE, messages);
    out.push({ id: t.id, title, createdAt, updatedAt, messages });
  }
  return out;
}

/** Cap every thread's messages to the last MAX_THREAD_MESSAGES. */
export function capThreadMessages(threads: DoubtThread[]): DoubtThread[] {
  return threads.map((t) =>
    t.messages.length > MAX_THREAD_MESSAGES
      ? { ...t, messages: t.messages.slice(-MAX_THREAD_MESSAGES) }
      : t
  );
}

/**
 * Wrap a legacy flat message list (`doubts-chat:<subjectId>`) into a single
 * thread titled from its first user message. Returns null when there is
 * nothing worth migrating.
 */
export function migrateLegacyMessages(raw: any, now: number = Date.now()): DoubtThread | null {
  if (!Array.isArray(raw)) return null;
  const messages = raw.map(sanitizeMessage).filter(Boolean) as DoubtStoredMessage[];
  if (messages.length === 0) return null;
  return {
    id: generateThreadId(),
    title: titleFromMessages(messages) ?? PLACEHOLDER_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: messages.slice(-MAX_THREAD_MESSAGES),
  };
}

/**
 * Load all threads for a subject, sorted by updatedAt DESC.
 * Runs the one-time legacy migration when the primary key is empty.
 * Corrupt JSON never throws — it yields an empty list.
 */
export async function loadThreads(subjectId: string): Promise<DoubtThread[]> {
  if (!subjectId) return [];
  let threads: DoubtThread[] = [];
  try {
    const rawPrimary = await AsyncStorage.getItem(threadsKey(subjectId));
    if (rawPrimary) {
      try {
        threads = sanitizeThreads(JSON.parse(rawPrimary));
      } catch {
        threads = [];
      }
    }
    if (threads.length === 0) {
      const rawLegacy = await AsyncStorage.getItem(legacyKey(subjectId));
      if (rawLegacy) {
        try {
          const migrated = migrateLegacyMessages(JSON.parse(rawLegacy));
          if (migrated) {
            threads = [migrated];
            await saveThreads(subjectId, threads);
          }
        } catch {
          // corrupt legacy payload — drop it below
        }
        await AsyncStorage.removeItem(legacyKey(subjectId));
      }
    }
  } catch {
    return [];
  }
  return sortThreads(threads);
}

/** Persist threads for a subject (messages capped). Never throws. */
export async function saveThreads(subjectId: string, threads: DoubtThread[]): Promise<void> {
  if (!subjectId) return;
  try {
    await AsyncStorage.setItem(threadsKey(subjectId), JSON.stringify(capThreadMessages(threads)));
  } catch {
    // Persistence is best-effort; the in-memory session keeps working.
  }
}

/**
 * Merge DB similar-question matches with the AI's suggested follow-ups:
 * DB matches first, deduped case-insensitively, capped at `limit`.
 */
export function mergeSuggestions(
  dbMatches: string[],
  aiSuggestions: string[],
  limit: number = 6
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...dbMatches, ...aiSuggestions]) {
    if (typeof s !== 'string') continue;
    const trimmed = s.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}
