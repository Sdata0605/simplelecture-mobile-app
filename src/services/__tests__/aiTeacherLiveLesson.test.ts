import { LiveTeacherClient } from '../aiTeacherLiveService';
import { teacherApi } from '../aiTeacherService';
import { ECHO_TAIL_MS, INTERRUPT_TAIL_MS } from '../askAssistant/echoGate';

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///mock_cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: { createAsync: jest.fn().mockResolvedValue({ sound: { unloadAsync: jest.fn(), stopAsync: jest.fn(), playAsync: jest.fn() } }) },
  },
}));

jest.mock('../aiTeacherService', () => ({
  teacherApi: jest.fn(),
}));

const teacherApiMock = teacherApi as jest.MockedFunction<typeof teacherApi>;

const prefs = { apiKey: '', apiMode: 'admin' as const, voice: 'Aoede', teacherName: 'Asha', preset: 'friendly', custom: '', language: 'auto' };

function makeClient(options: Record<string, unknown> = {}) {
  const callbacks = {
    onStatusChange: jest.fn(),
    onSpeakingChange: jest.fn(),
    onTranscriptUpdate: jest.fn(),
    onError: jest.fn(),
    onNotice: jest.fn(),
    onTurnComplete: jest.fn(),
  };
  const client = new LiveTeacherClient({ prefs, isByok: false, apiKey: '', callbacks, ...options });
  const ws = { send: jest.fn(), close: jest.fn() };
  (client as any).ws = ws;
  (client as any).status = 'live';
  return { client, callbacks, ws };
}

const micChunk = 'bW9ja19hdWRpb19kYXRh';
const sentToolResponses = (ws: { send: jest.Mock }) =>
  ws.send.mock.calls.map((c) => JSON.parse(c[0])).filter((m) => m.toolResponse).map((m) => m.toolResponse.functionResponses[0].response);

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('echo guard: the mic is closed while the teacher talks, and the student taps to interrupt', () => {
  it('drops even loud mic audio while the teacher is speaking (no voice barge-in, no self-interruption)', () => {
    const { client, ws } = makeClient({ echoGuard: true });
    (client as any).setSpeaking(true);
    client.sendRealtimeAudio(micChunk, 0.9);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('reopens the mic by itself a short tail after the teacher finishes, and the orb flips at the same moment', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    const { client, callbacks, ws } = makeClient({ echoGuard: true });
    (client as any).setSpeaking(true);
    (client as any).setSpeaking(false, true); // the queue ran dry naturally
    expect(callbacks.onSpeakingChange).toHaveBeenLastCalledWith(true); // still "speaking" during the tail
    client.sendRealtimeAudio(micChunk, 0.1);
    expect(ws.send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ECHO_TAIL_MS + 5);
    expect(callbacks.onSpeakingChange).toHaveBeenLastCalledWith(false);
    client.sendRealtimeAudio(micChunk, 0.1);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it('interrupt() stops the teacher at once, reopens the mic almost immediately, and drops the rest of that turn', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(2_000_000);
    const { client, callbacks, ws } = makeClient({ echoGuard: true });
    // the turn is open: one chunk of the teacher's words has arrived
    (client as any).handleAudioChunk(micChunk, (client as any).currentGeneration);
    const before = (client as any).currentPcmChunks.length;
    expect(before).toBe(1);
    (client as any).setSpeaking(true);

    client.interrupt();
    await Promise.resolve();
    expect(callbacks.onSpeakingChange).toHaveBeenLastCalledWith(false);
    // what the server still sends of the cut-off turn is dropped
    (client as any).handleAudioChunk(micChunk, (client as any).currentGeneration);
    expect((client as any).currentPcmChunks.length).toBe(0); // stopSpeaking cleared it, and nothing new was queued

    client.sendRealtimeAudio(micChunk, 0.1);
    expect(ws.send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(INTERRUPT_TAIL_MS + 5);
    client.sendRealtimeAudio(micChunk, 0.1);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it('keeps the old RMS barge-in shield when the echo guard is off (the AI Teacher tab is unchanged)', () => {
    const { client, ws } = makeClient();
    (client as any).isPlayingAudio = true;
    client.sendRealtimeAudio(micChunk, 0.015); // speaker leakage is dropped
    expect(ws.send).not.toHaveBeenCalled();
    (client as any).isPlayingAudio = false;
    client.sendRealtimeAudio(micChunk, 0.015);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it('reports speaking changes immediately when the echo guard is off', () => {
    const { client, callbacks } = makeClient();
    (client as any).setSpeaking(false, true);
    expect(callbacks.onSpeakingChange).toHaveBeenCalledWith(false);
  });
});

describe('sendText', () => {
  it('shows what the student typed, but not a request the screen makes for them', () => {
    const { client, callbacks, ws } = makeClient();
    client.sendText('why is the sky blue?');
    expect(callbacks.onTranscriptUpdate).toHaveBeenCalledTimes(1);

    callbacks.onTranscriptUpdate.mockClear();
    client.sendText('[Continue] Go on.', { silent: true });
    expect(callbacks.onTranscriptUpdate).not.toHaveBeenCalled();
    // both still reach the teacher
    const texts = ws.send.mock.calls.map((c) => JSON.parse(c[0]).clientContent?.turns?.[0]?.parts?.[0]?.text);
    expect(texts).toEqual(['why is the sky blue?', '[Continue] Go on.']);
  });
});

describe('keepGoing: explain each step, then carry on', () => {
  const step = (n: number, title: string) => ({ id: `fc${n}`, name: 'present_slide', args: { title, bullets: ['a'] } });

  it('tells the teacher, in the reply to a shown step, to explain it and carry on', async () => {
    const { client, ws } = makeClient({ keepGoing: true });
    await (client as any).handleToolCalls([step(1, 'Step 1 · The problem')], []);
    const [reply] = sentToolResponses(ws);
    expect(reply.status).toBe('shown');
    expect(reply.instruction).toContain('explain this step aloud properly');
    expect(reply.instruction).toContain('Never show a step without explaining it');
  });

  it('refuses the next step until the teacher has spoken about the previous one, then allows it', async () => {
    const { client, callbacks, ws } = makeClient({ keepGoing: true });
    await (client as any).handleToolCalls([step(1, 'Step 1 · The problem')], []);
    await (client as any).handleToolCalls([step(2, 'Step 2 · Subtract 3')], []);
    const replies = sentToolResponses(ws);
    expect(replies[1].status).toBe('not_shown');
    expect(replies[1].instruction).toContain('explained the previous step aloud');
    // the refused step was not put on the board
    const slides = callbacks.onTranscriptUpdate.mock.calls.length;
    expect(slides).toBe(1);

    (client as any).pacer.spoke(4000); // the teacher explained step 1 aloud
    await (client as any).handleToolCalls([step(3, 'Step 2 · Subtract 3')], []);
    expect(sentToolResponses(ws)[2].status).toBe('shown');
    expect(callbacks.onTranscriptUpdate.mock.calls.length).toBe(2);
  });

  it('does not change the tool replies when keepGoing is off', async () => {
    const { client, ws } = makeClient();
    await (client as any).handleToolCalls([step(1, 'Step 1 · The problem')], []);
    await (client as any).handleToolCalls([step(2, 'Step 2 · Subtract 3')], []);
    expect(sentToolResponses(ws)).toEqual([{ status: 'shown' }, { status: 'shown' }]);
  });

  it('allows lines of working: slides keep up to eight bullets', async () => {
    const { client, callbacks } = makeClient();
    const bullets = Array.from({ length: 10 }, (_, i) => `$$x = ${i}$$`);
    await (client as any).handleToolCalls([{ id: 'x', name: 'present_slide', args: { title: 'Step 2 · Move', bullets } }], []);
    const updater = callbacks.onTranscriptUpdate.mock.calls[0][0];
    const items = updater([]);
    expect(items[0].bullets).toHaveLength(8);
  });
});

describe('search_notes is grounded in the real notes of the lecture subject', () => {
  const call = { id: 'n1', name: 'search_notes', args: { query: 'reflection of light' } };

  it('looks the question up in the subject index', async () => {
    teacherApiMock.mockResolvedValueOnce({
      found: true,
      references: [{ chapter_title: 'Light', topic_title: 'Reflection', heading_path: 'Laws', content: 'Light bounces off a mirror.' }],
    });
    const { client, ws } = makeClient({ subjectId: 'subject-1' });
    await (client as any).handleToolCalls([call], []);
    expect(teacherApiMock).toHaveBeenCalledWith('search', { subjectId: 'subject-1', query: 'reflection of light' });
    const [reply] = sentToolResponses(ws);
    expect(reply.found).toBe(true);
    expect(reply.notes[0]).toEqual({ source: 'Light > Reflection > Laws', text: 'Light bounces off a mirror.' });
    expect(reply.instruction).toBe('Teach only from these notes.');
  });

  it('tells the teacher honestly when nothing relevant is in the notes', async () => {
    teacherApiMock.mockResolvedValueOnce({ found: false, references: [] });
    const { client, ws } = makeClient({ subjectId: 'subject-1' });
    await (client as any).handleToolCalls([call], []);
    expect(sentToolResponses(ws)[0]).toMatchObject({ found: false, instruction: expect.stringContaining('not in their notes') });
  });

  it('falls back to the generic note if the lookup fails, or when no subject is set (AI Teacher tab)', async () => {
    teacherApiMock.mockRejectedValueOnce(new Error('network'));
    const failing = makeClient({ subjectId: 'subject-1' });
    await (failing.client as any).handleToolCalls([call], []);
    expect(sentToolResponses(failing.ws)[0].notes[0].text).toContain('reflection of light');

    const plain = makeClient();
    await (plain.client as any).handleToolCalls([call], []);
    expect(teacherApiMock).toHaveBeenCalledTimes(1); // only the failing client looked anything up
    expect(sentToolResponses(plain.ws)[0].found).toBe(true);
  });
});

describe('turn complete', () => {
  it('reports the running total of finished teacher turns', async () => {
    const sockets: any[] = [];
    (global as any).WebSocket = class {
      onopen: any; onmessage: any; onerror: any; onclose: any; binaryType = '';
      send = jest.fn();
      close = jest.fn();
      constructor() { sockets.push(this); }
    };
    teacherApiMock.mockResolvedValueOnce({
      token: 'auth_tokens/x', apiVersion: 'v1alpha', model: 'm', voiceName: 'Aoede', teacherName: 'Asha',
      systemInstruction: 's', subjects: [], catalog: [], tools: [],
    });
    const callbacks = {
      onStatusChange: jest.fn(), onSpeakingChange: jest.fn(), onTranscriptUpdate: jest.fn(),
      onError: jest.fn(), onNotice: jest.fn(), onTurnComplete: jest.fn(),
    };
    const client = new LiveTeacherClient({ prefs, isByok: false, apiKey: '', callbacks });
    await client.connect('hello');
    const ws = sockets[0];
    await ws.onmessage({ data: JSON.stringify({ setupComplete: {} }) });
    await ws.onmessage({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
    await ws.onmessage({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
    expect(callbacks.onTurnComplete.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    client.disconnect();
  });
});
