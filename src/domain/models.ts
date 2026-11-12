export interface Video {
  id: string;
  url: string;
  title?: string;
  lastPositionMs?: number;
  lastStudiedAt?: string;
}
export interface TranscriptCue {
  startMs: number;
  durationMs: number;
  text: string;
}
export interface TranscriptTrack {
  languageCode: string;
  source: "manual" | "auto" | "imported" | "generated" | "unknown";
  cues: TranscriptCue[];
}
export interface CachedTranscript extends TranscriptTrack {
  id: string;
  videoId: string;
  cachedAt: string;
}
export interface Analysis {
  meaning: string;
  contextMeaning: string;
  partOfSpeech: string;
  tense: string;
  baseForm: string;
  isPhrasalVerb: boolean;
  grammarNotes: string;
  examples: string[];
  tags: string[];
}
export interface NotebookEntry {
  analysis?: Analysis;
  id: string;
  videoId: string;
  timestampMs: number;
  sentence: string;
  selection?: string;
  translation?: string;
  definition?: string;
  notes?: string;
  tags: string[];
  status: "new" | "learning" | "known";
  createdAt: string;
  updatedAt: string;
}
export interface Settings {
  id: "preferences";
  language: string;
}
export interface Backup {
  schemaVersion: 1;
  sessions?: import("../components/Exercises").Session[];
  exportedAt: string;
  videos: Video[];
  transcripts: CachedTranscript[];
  entries: NotebookEntry[];
  settings: Settings[];
}
