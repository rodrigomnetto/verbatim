const { z } = require("zod");
const { analysis, quiz } = require("./ai.cjs");
const date = z.string().datetime({ offset: true });
const id = z.string().min(1);
const ms = z.number().finite().nonnegative();
const video = z
  .object({
    id: z.string().regex(/^[\w-]{11}$/),
    url: z.string(),
    title: z.string().optional(),
    lastPositionMs: ms.optional(),
    lastStudiedAt: date.optional(),
  })
  .refine(
    (v) => v.url === `https://www.youtube.com/watch?v=${v.id}`,
    "Invalid video URL",
  );
const cue = z.object({
  startMs: ms,
  durationMs: z.number().finite().positive(),
  text: z.string(),
});
const transcript = z.object({
  id,
  videoId: id,
  languageCode: z.string(),
  source: z.enum(["manual", "auto", "generated", "imported", "unknown"]),
  cachedAt: date,
  cues: z
    .array(cue)
    .refine(
      (c) => c.every((x, i) => !i || x.startMs >= c[i - 1].startMs),
      "Unsorted captions",
    ),
});
const entry = z.object({
  id,
  videoId: id,
  timestampMs: ms,
  sentence: z.string(),
  selection: z.string().optional(),
  translation: z.string().optional(),
  definition: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()),
  status: z.enum(["new", "learning", "known"]),
  createdAt: date,
  updatedAt: date,
  analysis: analysis.optional(),
});
const session = z
  .object({
    id,
    createdAt: date,
    topic: z.string(),
    questions: quiz.shape.questions,
    answers: z.array(z.string()),
    completed: z.boolean(),
    score: z.number().int().nonnegative(),
  })
  .superRefine((s, c) => {
    if (
      s.score > s.questions.length ||
      (s.completed && s.answers.length !== s.questions.length)
    )
      c.addIssue({ code: "custom", message: "Invalid practice result" });
    if (
      s.completed &&
      s.score !==
        s.questions.filter(
          (q, i) => normalize(s.answers[i]) === normalize(q.answer),
        ).length
    )
      c.addIssue({ code: "custom", message: "Score does not match answers" });
  });
function normalize(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
}
const backup = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: date,
    videos: z.array(video),
    transcripts: z.array(transcript),
    entries: z.array(entry),
    settings: z
      .array(
        z.object({
          id: z.literal("preferences"),
          language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/),
        }),
      )
      .max(1),
    sessions: z.array(session).default([]),
  })
  .superRefine((b, c) => {
    const ids = new Set(b.videos.map((v) => v.id));
    for (const records of [b.videos, b.transcripts, b.entries, b.sessions])
      if (new Set(records.map((r) => r.id)).size !== records.length)
        c.addIssue({ code: "custom", message: "Duplicate record IDs" });
    if ([...b.entries, ...b.transcripts].some((r) => !ids.has(r.videoId)))
      c.addIssue({ code: "custom", message: "Missing source video" });
  });
module.exports = { backup, session };
