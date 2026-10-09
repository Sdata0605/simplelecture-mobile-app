// Shared contract for the pre-generated assistant voice clips (edge-tts MP3s
// bundled under mobile/assets/assistant-audio/). Mirrors the web app's
// src/components/learning/askAssistant/assistantAudioTypes.ts, except `src`
// is a bundled asset module id (via require()) instead of a public URL, since
// these clips ship inside the app rather than being fetched remotely.
export type AssistantClipCategory =
  | "greeting" // opening the assistant mid-lecture
  | "greetingEnd" // opening it automatically when the lecture ends
  | "followUp" // returning from an answer — "anything else?"
  | "thinking" // question received, request sent
  | "stillThinking" // request taking a while, nothing streamed yet
  | "found" // first part of the answer arrived
  | "preparingVisual" // text shown, animated explanation still rendering
  | "outOfScope" // question isn't covered by this subject's material
  | "didntCatch" // speech detected but transcript empty / too short
  | "error" // request failed
  | "stillThere"; // listened a long time without hearing anything

export interface AssistantClip {
  id: string;
  category: AssistantClipCategory;
  /** The exact line spoken — also shown as the assistant's caption. */
  text: string;
  /** Bundled asset module id, e.g. require('../../../assets/assistant-audio/greeting/greeting-01.mp3'). */
  src: number;
}
