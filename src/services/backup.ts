import { call, notifyChanged } from "../db/database";
import type { Backup } from "../domain/models";
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const string = (x: unknown) => typeof x === "string";
const number = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) && x >= 0;
const date = (x: unknown) =>
  string(x) && Number.isFinite(Date.parse(x as string));
const optional = (x: unknown) => x === undefined || string(x);
export function validateBackup(input: unknown): Backup {
  if (!object(input) || input.schemaVersion !== 1 || !date(input.exportedAt))
    throw new Error(
      "Unsupported or invalid backup. Expected schema version 1.",
    );
  for (const key of ["videos", "transcripts", "entries", "settings"])
    if (!Array.isArray(input[key]))
      throw new Error(`Backup is missing ${key}.`);
  const { videos, transcripts, entries, settings } = input as unknown as Backup;
  const ids = new Set<string>();
  for (const v of videos) {
    if (
      !object(v) ||
      !/^[\w-]{11}$/.test(v.id) ||
      v.url !== `https://www.youtube.com/watch?v=${v.id}` ||
      !optional(v.title) ||
      (v.lastPositionMs !== undefined && !number(v.lastPositionMs)) ||
      (v.lastStudiedAt !== undefined && !date(v.lastStudiedAt)) ||
      ids.has(v.id)
    )
      throw new Error("Invalid or duplicate video in backup.");
    ids.add(v.id);
  }
  const unique = (items: { id: string }[]) =>
    new Set(items.map((x) => x.id)).size === items.length;
  for (const t of transcripts)
    if (
      !object(t) ||
      !string(t.id) ||
      !ids.has(t.videoId) ||
      !string(t.languageCode) ||
      !["manual", "auto", "unknown", "imported", "generated"].includes(
        t.source,
      ) ||
      !date(t.cachedAt) ||
      !Array.isArray(t.cues) ||
      t.cues.some(
        (c, i) =>
          !object(c) ||
          !number(c.startMs) ||
          !number(c.durationMs) ||
          c.durationMs <= 0 ||
          !string(c.text) ||
          (i > 0 && c.startMs < t.cues[i - 1].startMs),
      )
    )
      throw new Error("Invalid transcript in backup.");
  for (const e of entries)
    if (
      !object(e) ||
      !string(e.id) ||
      !ids.has(e.videoId) ||
      !number(e.timestampMs) ||
      !string(e.sentence) ||
      !["new", "learning", "known"].includes(e.status) ||
      !date(e.createdAt) ||
      !date(e.updatedAt) ||
      !Array.isArray(e.tags) ||
      !e.tags.every(string) ||
      ![e.selection, e.translation, e.definition, e.notes].every(optional)
    )
      throw new Error("Invalid notebook entry in backup.");
  if (
    !unique(entries) ||
    !unique(transcripts) ||
    settings.length > 1 ||
    settings.some(
      (s) =>
        !object(s) ||
        s.id !== "preferences" ||
        !string(s.language) ||
        !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(s.language),
    )
  )
    throw new Error("Invalid backup records or preferences.");
  if (
    input.sessions !== undefined &&
    (!Array.isArray(input.sessions) ||
      input.sessions.some(
        (s: unknown) =>
          !object(s) ||
          !string(s.id) ||
          !Array.isArray(s.questions) ||
          !Array.isArray(s.answers),
      ))
  )
    throw new Error("Invalid exercise sessions.");
  return JSON.parse(JSON.stringify(input)) as Backup;
}
export async function exportBackup(): Promise<Backup> {
  return call<Backup>("backup");
}
export async function importBackup(input: unknown) {
  const b = validateBackup(input);
  await call("import", b);
  notifyChanged();
}
