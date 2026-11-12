import type { TranscriptTrack } from "../domain/models";
export interface TranscriptProvider {
  getTracks(videoId: string): Promise<TranscriptTrack[]>;
}
export interface DictionaryResult {
  word: string;
  phonetic?: string;
  meanings: { partOfSpeech: string; definition: string }[];
}
export interface DictionaryProvider {
  lookup(word: string): Promise<DictionaryResult>;
}
export interface TranslationProvider {
  translate(text: string, targetLanguage: string): Promise<string>;
}
