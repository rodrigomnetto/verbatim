import type { TranscriptProvider } from "./types";
import type { TranscriptCue, TranscriptTrack } from "../domain/models";
function time(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((n) => !Number.isFinite(n) || n < 0) ||
    parts.at(-1)! >= 60 ||
    (parts.length === 3 && parts[1] >= 60)
  )
    throw new Error("Invalid subtitle timestamp.");
  return Math.round(parts.reduce((sum, n) => sum * 60 + n, 0) * 1000);
}
export function parseSubtitles(input: string): TranscriptCue[] {
  const lines = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const cues: TranscriptCue[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[i])) {
      while (i < lines.length && lines[i].trim()) i++;
      continue;
    }
    if (!lines[i].includes("-->")) continue;
    const match = lines[i].match(
      /^\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})(?:\s.*)?$/,
    );
    if (!match) throw new Error("Unsupported subtitle timing format.");
    const startMs = time(match[1]);
    const end = time(match[2]);
    if (end <= startMs) throw new Error("Subtitle end must follow its start.");
    const body: string[] = [];
    while (++i < lines.length && lines[i].trim()) body.push(lines[i]);
    const text = body
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (text) cues.push({ startMs, durationMs: end - startMs, text });
  }
  if (!cues.length)
    throw new Error(
      "No timed captions found. Choose a valid .srt or .vtt file.",
    );
  return cues.sort((a, b) => a.startMs - b.startMs);
}
export class ImportedFileTranscriptProvider implements TranscriptProvider {
  private text: string;
  private languageCode: string;
  constructor(text: string, languageCode = "en") {
    this.text = text;
    this.languageCode = languageCode;
  }
  async getTracks(): Promise<TranscriptTrack[]> {
    return [
      {
        languageCode: this.languageCode,
        source: "imported",
        cues: parseSubtitles(this.text),
      },
    ];
  }
}
const pendingTranscripts = new Map<string, Promise<TranscriptTrack[]>>();
export class AutomaticTranscriptProvider implements TranscriptProvider {
  getTracks(videoId: string): Promise<TranscriptTrack[]> {
    const existing = pendingTranscripts.get(videoId);
    if (existing) return existing;
    const job = this.request(videoId).finally(() =>
      pendingTranscripts.delete(videoId),
    );
    pendingTranscripts.set(videoId, job);
    return job;
  }
  private async request(videoId: string): Promise<TranscriptTrack[]> {
    const result = {
      tracks: await window.verbatim.call<TranscriptTrack[]>(
        "transcribe",
        videoId,
      ),
    };
    if (!Array.isArray(result?.tracks) || !result.tracks.length)
      throw new Error("No transcript was returned for this video.");
    for (const track of result.tracks) {
      if (
        !track ||
        typeof track.languageCode !== "string" ||
        !["manual", "auto", "generated"].includes(track.source) ||
        !Array.isArray(track.cues) ||
        !track.cues.length ||
        track.cues.some(
          (cue: TranscriptCue, i: number) =>
            !cue ||
            typeof cue.text !== "string" ||
            !Number.isFinite(cue.startMs) ||
            cue.startMs < 0 ||
            !Number.isFinite(cue.durationMs) ||
            cue.durationMs <= 0 ||
            (i > 0 && cue.startMs < track.cues[i - 1].startMs),
        )
      )
        throw new Error(
          "The transcription service returned invalid timed cues.",
        );
    }
    return result.tracks as TranscriptTrack[];
  }
}
