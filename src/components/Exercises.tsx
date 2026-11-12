import { useState } from "react";
import { call, useLiveQuery, notifyChanged } from "../db/database";
import type { NotebookEntry } from "../domain/models";
type Question = {
  type: "fill-in-the-blank" | "multiple-choice";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
};
export type Session = {
  id: string;
  createdAt: string;
  topic: string;
  questions: Question[];
  answers: string[];
  completed: boolean;
  score: number;
};
const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
export function Exercises({ entries }: { entries: NotebookEntry[] }) {
  const [topic, setTopic] = useState("");
  const [grammar, setGrammar] = useState("");
  const [type, setType] = useState<Question["type"]>("fill-in-the-blank");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [checked, setChecked] = useState(false);
  const history =
    useLiveQuery(() => call<Session[]>("list", { table: "sessions" }), []) ??
    [];
  const categories = [
    ...new Set(
      entries.flatMap((e) => [
        ...e.tags,
        ...(e.analysis
          ? [
              e.analysis.partOfSpeech,
              e.analysis.tense,
              ...(e.analysis.isPhrasalVerb ? ["phrasal verb"] : []),
            ]
          : []),
      ]),
    ),
  ].sort();
  const lessons = entries.filter(
    (e) =>
      !grammar ||
      e.tags.includes(grammar) ||
      e.analysis?.partOfSpeech === grammar ||
      e.analysis?.tense === grammar ||
      (grammar === "phrasal verb" && e.analysis?.isPhrasalVerb),
  );
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await call<{ questions: Question[] }>("quiz", {
        topic: topic.trim() || grammar || "Review my saved expressions",
        type,
        count,
        lessons: lessons
          .slice(0, 25)
          .map((e) => ({
            expression: e.selection || e.sentence,
            context: e.sentence,
            meaning: e.analysis?.contextMeaning || e.definition,
            grammar: e.analysis?.grammarNotes,
          })),
      });
      const next: Session = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        topic: topic.trim() || grammar || "My expressions",
        questions: result.questions,
        answers: [],
        completed: false,
        score: 0,
      };
      await call("put", { table: "sessions", record: next });
      notifyChanged();
      setSession(next);
      setAnswers(Array(next.questions.length).fill(""));
      setChecked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!session) return;
    setError("");
    try {
      const score = session.questions.filter(
        (q, i) => normalize(answers[i] || "") === normalize(q.answer),
      ).length;
      const next = { ...session, answers, completed: true, score };
      await call("put", { table: "sessions", record: next });
      notifyChanged();
      setSession(next);
      setChecked(true);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM UNDERSTANDING TO REMEMBERING</div>
          <h1>Put your English into practice.</h1>
          <p>A little challenge, built around what you’re learning.</p>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <section className="settings-card exercise-config">
        <label className="field">
          Topic
          <input
            value={topic}
            maxLength={300}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Phrasal verbs at work"
          />
        </label>
        <label className="field">
          Saved lessons
          <select value={grammar} onChange={(e) => setGrammar(e.target.value)}>
            <option value="">All grammatical categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Question type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Question["type"])}
          >
            <option value="fill-in-the-blank">Fill in the blank</option>
            <option value="multiple-choice">Multiple choice</option>
          </select>
        </label>
        <label className="field">
          Questions
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          >
            {[3, 5, 10].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || (!topic.trim() && !lessons.length)}
          onClick={() => void generate()}
        >
          {busy ? "Creating your practice…" : "Generate exercises ↗"}
        </button>
        <small>
          {lessons.length} matching saved lessons · Up to 25 used per
          generation. Enter a topic to practice without saved lessons.
        </small>
      </section>
      {session && (
        <section className="exercise-session">
          <div className="section-heading">
            <h2>{session.topic}</h2>
            {checked && (
              <strong role="status">
                {session.score} / {session.questions.length} correct
              </strong>
            )}
          </div>
          {session.questions.map((q, i) => (
            <fieldset
              className="settings-card question"
              key={`${session.id}-${i}`}
              disabled={checked}
            >
              <legend>Question {i + 1}</legend>
              <h3>{q.prompt}</h3>
              {q.type === "multiple-choice" ? (
                q.options.map((option, j) => (
                  <label className="answer-option" key={j}>
                    <input
                      type="radio"
                      name={`${session.id}-${i}`}
                      value={option}
                      checked={answers[i] === option}
                      onChange={() =>
                        setAnswers((a) =>
                          a.map((v, k) => (k === i ? option : v)),
                        )
                      }
                    />
                    {option}
                  </label>
                ))
              ) : (
                <label className="field">
                  Your answer
                  <input
                    value={answers[i] || ""}
                    onChange={(e) =>
                      setAnswers((a) =>
                        a.map((v, k) => (k === i ? e.target.value : v)),
                      )
                    }
                  />
                </label>
              )}
              {checked && (
                <div
                  className={`feedback ${normalize(answers[i] || "") === normalize(q.answer) ? "correct" : "incorrect"}`}
                >
                  <strong>
                    {normalize(answers[i] || "") === normalize(q.answer)
                      ? "Correct"
                      : "Keep learning"}{" "}
                    · {q.answer}
                  </strong>
                  <p>{q.explanation}</p>
                </div>
              )}
            </fieldset>
          ))}
          {!checked && (
            <button
              className="primary"
              disabled={answers.some((a) => !a.trim())}
              onClick={() => void submit()}
            >
              Check answers
            </button>
          )}
          {checked && (
            <p className="helper">
              Fill-in-the-blank answers use the expected wording; capitalization
              and final punctuation are ignored.
            </p>
          )}
        </section>
      )}
      <div className="section-heading">
        <h2>Your practice history</h2>
        <span>{history.length} sessions</span>
      </div>
      {history.length ? (
        <div className="notebook-grid">
          {[...history]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((h) => (
              <button
                key={h.id}
                className="entry-card history-card"
                onClick={() => {
                  setSession(h);
                  setAnswers(
                    h.completed
                      ? h.answers
                      : Array(h.questions.length).fill(""),
                  );
                  setChecked(h.completed);
                }}
              >
                <small>{new Date(h.createdAt).toLocaleDateString()}</small>
                <h3>{h.topic}</h3>
                <p>
                  {h.completed
                    ? `${h.score} / ${h.questions.length} correct`
                    : "Ready to practice"}{" "}
                  ↗
                </p>
              </button>
            ))}
        </div>
      ) : (
        <div className="empty-library">
          <p>Your practice sessions will appear here.</p>
        </div>
      )}
    </>
  );
}
