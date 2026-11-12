const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Store } = require("../electron/store.cjs");
const { generate, analysis } = require("../electron/ai.cjs");
const valid = {
  meaning: "To postpone.",
  contextMeaning: "They postponed the meeting.",
  partOfSpeech: "phrasal verb",
  tense: "Past simple",
  baseForm: "put off",
  isPhrasalVerb: true,
  grammarNotes: "Separable transitive phrasal verb.",
  examples: ["We put off the trip."],
  tags: ["phrasal verb", "Past simple"],
};
test("SQLite persists records across reopening and excludes secrets from backup", () => {
  const { mkdtempSync, rmSync } = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "verbatim-test-"));
  const file = path.join(dir, "test.sqlite");
  let s = new Store(file);
  try {
    s.put("entries", { id: "one", analysis: valid });
    s.put("settings", { id: "api-key", value: "secret" });
    s.close();
    s = new Store(file);
    assert.equal(
      s.list("entries")[0].analysis.contextMeaning,
      valid.contextMeaning,
    );
    assert.equal(JSON.stringify(s.backup()).includes("secret"), false);
  } finally {
    s.close();
    rmSync(dir, { recursive: true });
  }
});
test("atomic batch rolls back every table on invalid input", () => {
  const s = new Store(":memory:");
  try {
    assert.throws(() => s.batch({ entries: [{ id: "one" }], videos: [{}] }));
    assert.deepEqual(s.list("entries"), []);
    assert.throws(() => s.list("entries; DROP TABLE entries"));
  } finally {
    s.close();
  }
});
test("Gemini uses the fixed requested model and structured English analysis", async () => {
  let request;
  const result = await generate(
    "test",
    "analyze",
    { expression: "put off", context: "They put off the meeting." },
    async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: JSON.stringify(valid) }] },
            },
          ],
        }),
      };
    },
  );
  assert.equal(result.isPhrasalVerb, true);
  assert.match(request.url, /gemini-2.5-flash-lite:generateContent$/);
  assert.equal(request.options.headers["x-goog-api-key"], "test");
  assert.match(
    JSON.parse(request.options.body).systemInstruction.parts[0].text,
    /Never translate/,
  );
});
test("quota and malformed output produce actionable errors", async () => {
  await assert.rejects(
    generate("test", "analyze", {}, async () => ({ ok: false, status: 429 })),
    /quota/,
  );
  await assert.rejects(
    generate("test", "analyze", {}, async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          { finishReason: "STOP", content: { parts: [{ text: "{}" }] } },
        ],
      }),
    })),
    /invalid response/,
  );
  assert.equal(
    analysis.safeParse({ ...valid, partOfSpeech: "unknown" }).success,
    false,
  );
});
test("exercise responses reject wrong type, count and invalid alternatives", async () => {
  const fake = (q) => async () => ({
    ok: true,
    json: async () => ({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify({ questions: q }) }] },
        },
      ],
    }),
  });
  const q = {
    type: "multiple-choice",
    prompt: "What does put off mean?",
    options: ["postpone", "start", "end", "run"],
    answer: "postpone",
    explanation: "It means postpone.",
  };
  const result = await generate(
    "test",
    "quiz",
    { type: "multiple-choice", count: 1 },
    fake([q]),
  );
  assert.equal(result.questions.length, 1);
  await assert.rejects(
    generate("test", "quiz", { type: "multiple-choice", count: 2 }, fake([q])),
    /invalid/,
  );
  await assert.rejects(
    generate(
      "test",
      "quiz",
      { type: "fill-in-the-blank", count: 1 },
      fake([q]),
    ),
    /invalid/,
  );
  await assert.rejects(
    generate(
      "test",
      "quiz",
      { type: "multiple-choice", count: 1 },
      fake([{ ...q, answer: "missing" }]),
    ),
    /invalid/,
  );
});
test("backup validation preserves English Notes records and rejects invalid analysis and history", () => {
  const { backup } = require("../electron/backup.cjs");
  const now = new Date().toISOString();
  const b = {
    schemaVersion: 1,
    exportedAt: now,
    videos: [
      { id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ],
    transcripts: [],
    entries: [
      {
        id: "one",
        videoId: "dQw4w9WgXcQ",
        timestampMs: 0,
        sentence: "They put off the meeting.",
        selection: "put off",
        tags: [],
        status: "new",
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: [],
  };
  assert.equal(backup.parse(b).entries.length, 1);
  assert.deepEqual(backup.parse(b).sessions, []);
  assert.equal(
    backup.safeParse({ ...b, entries: [{ ...b.entries[0], analysis: {} }] })
      .success,
    false,
  );
  assert.equal(
    backup.safeParse({ ...b, sessions: [{ id: "bad", questions: [] }] })
      .success,
    false,
  );
  assert.equal(backup.safeParse({ ...b, videos: [] }).success, false);
});
