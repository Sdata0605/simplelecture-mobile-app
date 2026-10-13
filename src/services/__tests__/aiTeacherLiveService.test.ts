import {
  LiveTeacherClient,
  TranscriptItem,
  QuizItem,
  base64ToUint8Array,
  uint8ArrayToBase64,
  createWavFromBase64Chunks,
} from '../aiTeacherLiveService';

// Mock dependencies
jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///mock_cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///mock_cache/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Sound: {
      createAsync: jest.fn().mockResolvedValue({
        sound: {
          unloadAsync: jest.fn().mockResolvedValue(undefined),
          stopAsync: jest.fn().mockResolvedValue(undefined),
          playAsync: jest.fn().mockResolvedValue(undefined),
        },
      }),
    },
  },
}));

jest.mock('../aiTeacherService', () => ({
  teacherApi: jest.fn().mockImplementation((action: string) => {
    if (action === 'session') {
      return Promise.resolve({
        token: 'auth_tokens/test_mock_token_12345',
        apiVersion: 'v1alpha',
        model: 'gemini-3.8-live',
        voiceName: 'Aoede',
        teacherName: 'AI Teacher',
        systemInstruction: 'You are an AI teacher.',
        subjects: [{ id: 'sub-1', name: 'Science', topics: 10 }],
        catalog: [],
        tools: [],
      });
    }
    return Promise.resolve({});
  }),
}));

describe('LiveTeacherClient & Gemini Audio Processing', () => {
  let mockCallbacks: any;
  let client: LiveTeacherClient;

  beforeEach(() => {
    mockCallbacks = {
      onStatusChange: jest.fn(),
      onSpeakingChange: jest.fn(),
      onTranscriptUpdate: jest.fn(),
      onError: jest.fn(),
      onNotice: jest.fn(),
      onSubjectChange: jest.fn(),
    };

    client = new LiveTeacherClient({
      prefs: {
        apiKey: '',
        apiMode: 'admin',
        voice: 'Aoede',
        teacherName: 'Test AI Teacher',
        preset: 'friendly',
        custom: '',
        language: 'auto',
      },
      isByok: false,
      apiKey: '',
      callbacks: mockCallbacks,
    });
  });

  afterEach(() => {
    client.disconnect();
    jest.clearAllMocks();
  });

  describe('Audio Converter Functions', () => {
    test('base64ToUint8Array and uint8ArrayToBase64 round-trip correctly', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 255, 128, 64, 0]);
      const b64 = uint8ArrayToBase64(original);
      const decoded = base64ToUint8Array(b64);
      expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    test('createWavFromBase64Chunks creates valid 24kHz WAV header and concatenates PCM', () => {
      const chunk1 = uint8ArrayToBase64(new Uint8Array([10, 20, 30, 40]));
      const chunk2 = uint8ArrayToBase64(new Uint8Array([50, 60]));
      const wavBase64 = createWavFromBase64Chunks([chunk1, chunk2], 24000);

      const wavBytes = base64ToUint8Array(wavBase64);
      expect(wavBytes.length).toBe(44 + 6); // 44 bytes header + 6 bytes PCM

      // Check RIFF header magic bytes
      expect(String.fromCharCode(wavBytes[0], wavBytes[1], wavBytes[2], wavBytes[3])).toBe('RIFF');
      expect(String.fromCharCode(wavBytes[8], wavBytes[9], wavBytes[10], wavBytes[11])).toBe('WAVE');
      expect(String.fromCharCode(wavBytes[12], wavBytes[13], wavBytes[14], wavBytes[15])).toBe('fmt ');

      const view = new DataView(wavBytes.buffer);
      // Sample rate at offset 24 should be 24000
      expect(view.getUint32(24, true)).toBe(24000);
      // Bits per sample at offset 34 should be 16
      expect(view.getUint16(34, true)).toBe(16);
      // Data bytes at offset 44+ should match PCM
      expect(Array.from(wavBytes.slice(44))).toEqual([10, 20, 30, 40, 50, 60]);
    });
  });

  describe('LiveTeacherClient Lifecycle', () => {
    test('initializes with idle status and unmuted state', () => {
      expect(client.getStatus()).toBe('idle');
      expect(client.isMuted()).toBe(false);
    });

    test('toggleMute toggles muted state', () => {
      expect(client.toggleMute()).toBe(true);
      expect(client.isMuted()).toBe(true);
      expect(client.toggleMute()).toBe(false);
      expect(client.isMuted()).toBe(false);
    });

    test('disconnect sets status to ended and resets speaking', () => {
      client.disconnect();
      expect(client.getStatus()).toBe('ended');
      expect(mockCallbacks.onStatusChange).toHaveBeenCalledWith('ended');
    });

    test('reportQuizAnswer formats answer turn with option letter', () => {
      const quiz: QuizItem = {
        id: 'q1',
        question: 'What is H2O?',
        options: ['Hydrogen', 'Water', 'Oxygen', 'Salt'],
        correctIndex: 1,
      };

      client.reportQuizAnswer(quiz, 1);
      expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalled();
    });

    test('reportUnderstanding formats understanding choice turn', () => {
      client.reportUnderstanding('Chemical Bonding', 'got_it');
      expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalled();
    });

    test('answerBigQuestion formats answer turn', () => {
      client.answerBigQuestion('Explain photosynthesis', 'It converts sunlight into chemical energy');
      expect(mockCallbacks.onTranscriptUpdate).toHaveBeenCalled();
    });

    test('stopSpeaking resets speaking state and clears playback queue', async () => {
      await client.stopSpeaking();
      expect(mockCallbacks.onSpeakingChange).toHaveBeenCalledWith(false);
    });

    test('sendRealtimeAudio invokes onMicLevel callback', () => {
      mockCallbacks.onMicLevel = jest.fn();
      client.sendRealtimeAudio('bW9ja19hdWRpb19kYXRh', 0.08);
      expect(mockCallbacks.onMicLevel).toHaveBeenCalledWith(0.08);
    });

    test('sendRealtimeAudio suppresses low-RMS audio when teacher is playing audio (echo prevention shield)', () => {
      const mockWs = { send: jest.fn() };
      (client as any).ws = mockWs;
      (client as any).status = 'live';
      (client as any).isPlayingAudio = true;

      // Speaker leakage (< 0.040) should be dropped to prevent false self-interruption
      client.sendRealtimeAudio('c3BlYWtlcl9sZWFrYWdl', 0.015);
      expect(mockWs.send).not.toHaveBeenCalled();

      // Deliberate student speech (>= 0.040) triggers barge-in
      const stopSpy = jest.spyOn(client, 'stopSpeaking');
      client.sendRealtimeAudio('c3R1ZGVudF9zcGVha2luZw==', 0.06);
      expect(stopSpy).toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalled();
      const sentPayload = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentPayload.realtimeInput.mediaChunks[0].mimeType).toBe('audio/pcm;rate=16000');
      expect(sentPayload.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    });
  });
});
