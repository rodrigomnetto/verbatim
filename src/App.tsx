import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLiveQuery, call } from "./db/database";
import { Exercises } from "./components/Exercises";
import { GeminiSettings } from "./components/GeminiSettings";
import { Meaning } from "./components/Meaning";
import {
  BookOpen,
  Library,
  Settings,
  Layers,
  ArrowUpRight,
  Plus,
  Search,
  Upload,
  Download,
  X,
  Check,
  ArrowLeft,
  Leaf,
  Bookmark,
  MoreHorizontal,
  Play,
  Trash2,
  Pencil,
  ChevronRight,
} from "lucide-react";
import { db } from "./db/database";
import type {
  Analysis,
  NotebookEntry,
  TranscriptCue,
  Video,
} from "./domain/models";
import { parseVideoId, timestamp } from "./utils/video";
import {
  AutomaticTranscriptProvider,
  ImportedFileTranscriptProvider,
} from "./services/transcripts";

import { exportBackup, importBackup, validateBackup } from "./services/backup";
import { VideoPlayer } from "./components/VideoPlayer";

type Page =
  "library" | "study" | "notebook" | "review" | "settings" | "exercises";
const navigation = [
  { id: "library", label: "Video library", icon: Library },
  { id: "notebook", label: "My notebook", icon: BookOpen },
  { id: "review", label: "Flashcards", icon: Layers },
  { id: "exercises", label: "Exercises", icon: Pencil },
] as const;
export default function App() {
  useEffect(() => {
    const handler = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("verbatim:error", handler);
    return () => window.removeEventListener("verbatim:error", handler);
  }, []);
  const [page, setPage] = useState<Page>("library");
  const [active, setActive] = useState<Video | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("");
  const videos =
    useLiveQuery(
      () => db.videos.orderBy("lastStudiedAt").reverse().toArray(),
      [],
    ) ?? [];
  const entries =
    useLiveQuery(
      () => db.entries.orderBy("createdAt").reverse().toArray(),
      [],
    ) ?? [];

  const tracks =
    useLiveQuery(
      () =>
        active
          ? db.transcripts.where("videoId").equals(active.id).toArray()
          : [],
      [active?.id],
    ) ?? [];
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState("");
  const [transcriptRetry, setTranscriptRetry] = useState(0);
  const [trackId, setTrackId] = useState("");
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ ms: number; nonce: number } | null>(null);
  const lastWrite = useRef(0);
  const [follow, setFollow] = useState(true);
  const cueRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [draft, setDraft] = useState<NotebookEntry | null>(null);
  const [lookup, setLookup] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const reviewEntries = reviewIds
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is NotebookEntry => !!e);
  const card = reviewEntries[reviewIndex];
  useEffect(() => {
    if (page !== "study" || !active) return;
    const videoId = active.id;
    let disposed = false;
    setTranscriptError("");
    setTranscriptLoading(true);
    async function load() {
      try {
        const cached = await db.transcripts
          .where("videoId")
          .equals(videoId)
          .count();
        if (cached) return;
        const results = await new AutomaticTranscriptProvider().getTracks(
          videoId,
        );
        // Keep successful work even when the user navigates away mid-request.
        await db.transcripts.bulkPut(
          results.map((t) => ({
            ...t,
            id: `${videoId}:${t.languageCode}:${t.source}`,
            videoId,
            cachedAt: new Date().toISOString(),
          })),
        );
      } catch (e) {
        if (!disposed)
          setTranscriptError(
            e instanceof Error
              ? e.message
              : "Automatic transcription failed. Please retry.",
          );
      } finally {
        if (!disposed) setTranscriptLoading(false);
      }
    }
    void load();
    return () => {
      disposed = true;
    };
  }, [active?.id, page, transcriptRetry]);
  const currentCue =
    track?.cues.findIndex(
      (c) => time >= c.startMs && time < c.startMs + c.durationMs,
    ) ?? -1;
  useEffect(() => {
    if (follow && currentCue >= 0)
      cueRefs.current[currentCue]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
  }, [currentCue, follow]);
  useEffect(() => {
    const handler = () => {
      if (active)
        void db.videos
          .update(active.id, { lastPositionMs: time })
          .catch(() => {});
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [active, time]);
  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    }
  }
  async function openVideo(video: Video, ms?: number) {
    if (active) await db.videos.update(active.id, { lastPositionMs: time });
    await db.videos.put({ ...video, lastStudiedAt: new Date().toISOString() });
    setActive(video);
    setTime(ms ?? video.lastPositionMs ?? 0);
    setSeek({ ms: ms ?? video.lastPositionMs ?? 0, nonce: Date.now() });
    setTrackId("");
    setPage("study");
    setDraft(null);
    setError("");
  }
  function addVideo(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const id = parseVideoId(url);
      const existing = await db.videos.get(id);
      await openVideo(
        existing ?? {
          id,
          url: `https://www.youtube.com/watch?v=${id}`,
          title: `YouTube video · ${id}`,
        },
      );
      setUrl("");
    });
  }
  function capture(cue: TranscriptCue, selection?: string) {
    if (!active) return;
    const now = new Date().toISOString();
    setLookup("");
    setDraft({
      id: crypto.randomUUID(),
      videoId: active.id,
      timestampMs: cue.startMs,
      sentence: cue.text,
      selection: selection?.trim() || "",
      tags: [],
      status: "new",
      createdAt: now,
      updatedAt: now,
    });
  }
  async function analyze() {
    if (!draft) return;
    const id = draft.id;
    setBusy(true);
    setLookup("");
    try {
      const a = await call<Analysis>("analyze", {
        expression: draft.selection || draft.sentence,
        context: draft.sentence,
      });
      setDraft((d) =>
        d?.id === id &&
        d.sentence === draft.sentence &&
        d.selection === draft.selection
          ? {
              ...d,
              analysis: a,
              definition: a.meaning,
              tags: [
                ...new Set([
                  ...d.tags,
                  ...a.tags,
                  a.partOfSpeech,
                  ...(a.isPhrasalVerb ? ["phrasal verb"] : []),
                ]),
              ],
            }
          : d,
      );
    } catch (e) {
      setLookup(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }
  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    await run(async () => {
      if (!draft.sentence.trim()) throw new Error("Add a source sentence.");
      await db.entries.put({
        ...draft,
        tags: [...new Set(draft.tags.map((t) => t.trim()).filter(Boolean))],
        updatedAt: new Date().toISOString(),
      });
      setDraft(null);
      setNotice("Saved to your notebook.");
    });
  }
  const filtered = entries.filter(
    (e) =>
      (status === "all" || e.status === status) &&
      (!tag ||
        e.tags.includes(tag) ||
        e.analysis?.partOfSpeech === tag ||
        e.analysis?.tense === tag ||
        (tag === "phrasal verb" && e.analysis?.isPhrasalVerb)) &&
      [
        e.selection,
        e.sentence,
        e.notes,
        e.analysis?.contextMeaning,
        e.definition,
        e.tags.join(" "),
        videos.find((v) => v.id === e.videoId)?.title,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const allTags = [
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
  function nav(p: Page) {
    if (page === "study" && active)
      void db.videos
        .update(active.id, { lastPositionMs: time })
        .catch(() => setError("Could not save playback progress."));
    setPage(p);
    setError("");
    setNotice("");
    setDraft(null);
    if (p === "review") {
      setReviewIndex(0);
      setFlipped(false);
      setReviewed(0);
      setReviewIds(
        entries.filter((e) => e.status !== "known").map((e) => e.id),
      );
    }
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("library");
          }}
        >
          <span className="brand-icon">
            <BookOpen size={23} />
          </span>
          <span>
            verbatim<span className="brand-light">.</span>
            <small>A LITTLE EVERY DAY.</small>
          </span>
        </a>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={
                page === n.id || (page === "study" && n.id === "library")
                  ? "nav-item selected"
                  : "nav-item"
              }
              onClick={() => nav(n.id)}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "notebook" && (
                <span className="count">{entries.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-illustration">
            <Leaf size={28} />
          </span>
          <strong>Small steps. Real progress.</strong>
          <p>Every expression you save is another piece of your English.</p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${page === "settings" ? "selected" : ""}`}
            onClick={() => nav("settings")}
          >
            <Settings size={18} />
            Settings & data
          </button>
          <div className="local-indicator">
            <span />
            Stored on this device
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>YOUR PERSONAL ENGLISH SPACE · VERBATIM</span>
          <div>
            <span className="privacy-pill">
              <span />
              Local-first, always yours
            </span>
            <span className="avatar">YOU</span>
          </div>
        </header>
        <div className="content">
          {page === "exercises" && <Exercises entries={entries} />}{" "}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={17} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {page === "library" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">WATCH. NOTICE. REMEMBER.</div>
                  <h1>Your next little breakthrough.</h1>
                  <p>
                    Turn the videos you love into English that stays with you.
                  </p>
                </div>
                <span className="edition">
                  THE EVERYDAY EDITION <span>↗</span>
                </span>
              </div>
              <section className="start-card">
                <div className="start-copy">
                  <span className="eyebrow">A GOOD PLACE TO START</span>
                  <h2>
                    One video.
                    <br />A whole new vocabulary.
                  </h2>
                  <p>
                    Bring a YouTube video. Catch an expression.
                    <br />
                    Make it part of your everyday English.
                  </p>
                  <form className="url-form" onSubmit={addVideo}>
                    <label className="sr-only" htmlFor="video-url">
                      YouTube URL or video ID
                    </label>
                    <input
                      id="video-url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste a YouTube link here…"
                      required
                    />
                    <button type="submit">
                      Start learning <ArrowUpRight size={17} />
                    </button>
                  </form>
                  <small>
                    No account. No pressure. Just a little practice.
                  </small>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <span className="art-star">✳</span>
                  <div className="word-card">
                    <span>WORDS WORTH KEEPING</span>
                    <strong>little by little</strong>
                    <em>/ˈlɪt.əl baɪ ˈlɪt.əl/</em>
                    <div />
                    <p>
                      Small moments of learning.
                      <br />A lasting change.
                    </p>
                    <span className="word-tag">
                      expression <ArrowUpRight size={15} />
                    </span>
                  </div>
                  <div className="floating-note">
                    <Bookmark size={17} /> Make it yours.
                  </div>
                </div>
              </section>
              <section className="stats">
                <div>
                  <span className="stat-icon sage">
                    <Library size={21} />
                  </span>
                  <span>
                    <strong>{videos.length}</strong>
                    <small>videos explored</small>
                  </span>
                </div>
                <div>
                  <span className="stat-icon peach">
                    <Bookmark size={21} />
                  </span>
                  <span>
                    <strong>{entries.length}</strong>
                    <small>expressions collected</small>
                  </span>
                </div>
                <div>
                  <span className="stat-icon lilac">
                    <Check size={21} />
                  </span>
                  <span>
                    <strong>
                      {entries.filter((e) => e.status === "known").length}
                    </strong>
                    <small>expressions made yours</small>
                  </span>
                </div>
                <p>
                  A growing collection.
                  <br />
                  <em>A more confident you.</em>
                </p>
              </section>
              <div className="section-heading">
                <h2>
                  Your video library <span>{videos.length}</span>
                </h2>
                <span>Pick up where you left off</span>
              </div>
              {videos.length ? (
                <div className="video-grid">
                  {videos.map((v) => (
                    <button
                      className="video-card"
                      key={v.id}
                      onClick={() => void run(() => openVideo(v))}
                    >
                      <div className="video-cover">
                        <img
                          src={`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                          alt=""
                          loading="lazy"
                        />
                        <span className="play-circle">
                          <Play fill="currentColor" size={20} />
                        </span>
                        <span className="duration">
                          Resume {timestamp(v.lastPositionMs ?? 0)}
                        </span>
                      </div>
                      <div className="video-info">
                        <small>
                          YOUTUBE ·{" "}
                          {new Date(
                            v.lastStudiedAt ?? Date.now(),
                          ).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </small>
                        <h3>{v.title ?? v.id}</h3>
                        <span>
                          {entries.filter((e) => e.videoId === v.id).length}{" "}
                          saved expressions <ChevronRight size={15} />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-library">
                  <span className="empty-icon">
                    <Library size={27} />
                  </span>
                  <div>
                    <h3>A fresh page, full of possibilities.</h3>
                    <p>
                      Your videos will live here. Paste a link above to start
                      your first session.
                    </p>
                  </div>
                  <ArrowUpRight size={25} />
                </div>
              )}
              <footer>
                <span>A little curiosity goes a long way.</span>
                <span>
                  Made for the way you learn. <Leaf size={14} />
                </span>
              </footer>
            </>
          )}
          {page === "study" && active && (
            <>
              <button className="back-link" onClick={() => nav("library")}>
                <ArrowLeft size={16} />
                Video library
              </button>
              <div className="page-heading compact">
                <div>
                  <div className="eyebrow">YOUR STUDY SESSION</div>
                  <h1 className="video-title">{active.title ?? active.id}</h1>
                  <p>Listen closely. Find something worth keeping.</p>
                </div>
              </div>
              <div className="study-grid">
                <section>
                  <VideoPlayer
                    id={active.id}
                    initialMs={active.lastPositionMs ?? 0}
                    seek={seek}
                    onTime={(ms) => {
                      setTime(ms);
                      if (Date.now() - lastWrite.current > 5000) {
                        lastWrite.current = Date.now();
                        void db.videos
                          .update(active.id, { lastPositionMs: ms })
                          .catch(() =>
                            setError(
                              "Could not save playback progress. Check device storage.",
                            ),
                          );
                      }
                    }}
                    onTitle={(title) => {
                      setActive((v) => (v ? { ...v, title } : v));
                      void db.videos
                        .update(active.id, { title })
                        .catch(() => {});
                    }}
                  />
                  <div className="session-tip">
                    <Leaf size={20} />
                    <div>
                      <strong>Stay curious, one phrase at a time.</strong>
                      <p>
                        Select text in the transcript to capture an expression,
                        or use the bookmark button to save a whole sentence.
                      </p>
                    </div>
                  </div>
                  <div className="section-heading">
                    <h2>From this video</h2>
                    <span>
                      {entries.filter((e) => e.videoId === active.id).length}{" "}
                      expressions
                    </span>
                  </div>
                  {entries
                    .filter((e) => e.videoId === active.id)
                    .map((e) => (
                      <button
                        key={e.id}
                        className="mini-entry"
                        onClick={() => {
                          setDraft(e);
                          setLookup("");
                        }}
                      >
                        <Bookmark size={16} />
                        <strong>{e.selection || e.sentence}</strong>
                        <span>{timestamp(e.timestampMs)}</span>
                      </button>
                    ))}
                </section>
                <section className="transcript-panel">
                  <div className="transcript-heading">
                    <h2>Transcript</h2>
                    <label className="import-button">
                      <Upload size={15} />
                      Import
                      <input
                        type="file"
                        accept=".vtt,.srt"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            void run(async () => {
                              if (file.size > 5_000_000)
                                throw new Error(
                                  "Choose a subtitle file smaller than 5 MB.",
                                );
                              const [t] =
                                await new ImportedFileTranscriptProvider(
                                  await file.text(),
                                ).getTracks();
                              const id = `${active.id}:en:imported`;
                              await db.transcripts.put({
                                ...t,
                                id,
                                videoId: active.id,
                                cachedAt: new Date().toISOString(),
                              });
                              setTrackId(id);
                            });
                        }}
                      />
                    </label>
                  </div>
                  {track ? (
                    <>
                      <div className="transcript-meta">
                        <select
                          aria-label="Transcript track"
                          value={track.id}
                          onChange={(e) => setTrackId(e.target.value)}
                        >
                          {tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.languageCode} · {t.source}
                            </option>
                          ))}
                        </select>
                        <label>
                          <input
                            type="checkbox"
                            checked={follow}
                            onChange={(e) => setFollow(e.target.checked)}
                          />
                          Follow playback
                        </label>
                      </div>
                      <div className="transcript-cues">
                        {track.cues.map((c, i) => (
                          <div
                            ref={(el) => {
                              cueRefs.current[i] = el;
                            }}
                            className={`cue ${i === currentCue ? "active" : ""}`}
                            key={`${c.startMs}-${i}`}
                          >
                            <button
                              className="cue-time"
                              onClick={() =>
                                setSeek({ ms: c.startMs, nonce: Date.now() })
                              }
                              aria-label={`Seek to ${timestamp(c.startMs)}`}
                            >
                              {timestamp(c.startMs)}
                            </button>
                            <p
                              tabIndex={0}
                              onMouseUp={() => {
                                const s = window.getSelection();
                                if (
                                  s &&
                                  !s.isCollapsed &&
                                  s.anchorNode &&
                                  s.focusNode &&
                                  cueRefs.current[i]?.contains(s.anchorNode) &&
                                  cueRefs.current[i]?.contains(s.focusNode)
                                )
                                  capture(c, s.toString());
                              }}
                              onKeyUp={(e) => {
                                if (e.key === "Enter")
                                  capture(c, window.getSelection()?.toString());
                              }}
                            >
                              {c.text}
                            </p>
                            <button
                              className="cue-save"
                              aria-label={`Save sentence at ${timestamp(c.startMs)}`}
                              onClick={() => capture(c)}
                            >
                              <Bookmark size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="transcript-empty" aria-live="polite">
                      <Layers size={32} />
                      <h3>
                        {transcriptLoading
                          ? "Finding the words…"
                          : "Transcript unavailable"}
                      </h3>
                      {transcriptLoading ? (
                        <>
                          <p>
                            Getting English captions, or generating a timed
                            transcript from the audio when captions aren’t
                            available.
                          </p>
                          <small>
                            First-time speech recognition downloads a model.
                            This may take several minutes. You can keep
                            watching.
                          </small>
                          <span
                            className="transcription-spinner"
                            aria-hidden="true"
                          />
                        </>
                      ) : (
                        <>
                          <p role="alert">
                            {transcriptError ||
                              "No transcript is available for this video yet."}
                          </p>
                          <button
                            className="primary"
                            onClick={() => setTranscriptRetry((n) => n + 1)}
                          >
                            Retry transcription
                          </button>
                          <p>
                            <small>
                              Use videos you have permission to process. You can
                              also import captions as a fallback.
                            </small>
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "notebook" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    A COLLECTION OF LITTLE DISCOVERIES
                  </div>
                  <h1>Your words, in context.</h1>
                  <p>Expressions you noticed. Ideas you want to keep.</p>
                </div>
                <button className="primary" onClick={() => nav("review")}>
                  <Layers size={17} />
                  Practice expressions
                </button>
              </div>
              <div className="filters">
                <div className="search">
                  <Search size={18} />
                  <input
                    aria-label="Search notebook"
                    placeholder="Search expressions, notes, or videos…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All progress</option>
                  <option value="new">New</option>
                  <option value="learning">Learning</option>
                  <option value="known">Known</option>
                </select>
                <select
                  aria-label="Filter by tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                >
                  <option value="">All tags & grammar</option>
                  {allTags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="notebook-grid">
                {filtered.map((e) => (
                  <article className="entry-card" key={e.id}>
                    <div className="entry-top">
                      <span className={`status ${e.status}`}>{e.status}</span>
                      <div>
                        <button
                          aria-label="Edit entry"
                          onClick={() => {
                            setDraft(e);
                            setLookup("");
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          aria-label="Delete entry"
                          onClick={() => {
                            if (window.confirm("Delete this notebook entry?"))
                              void run(async () => {
                                await db.entries.delete(e.id);
                              });
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <h2>{e.selection || e.sentence}</h2>
                    {e.selection && <blockquote>{e.sentence}</blockquote>}
                    {e.analysis && <Meaning analysis={e.analysis} />}
                    {!e.analysis && e.definition && <p>{e.definition}</p>}
                    {e.notes && <p className="entry-notes">{e.notes}</p>}
                    <div className="tags">
                      {e.tags.map((t) => (
                        <button key={t} onClick={() => setTag(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <button
                      className="source-link"
                      onClick={() =>
                        void run(async () => {
                          const v = await db.videos.get(e.videoId);
                          if (v) await openVideo(v, e.timestampMs);
                        })
                      }
                    >
                      <Play size={13} />
                      {timestamp(e.timestampMs)} ·{" "}
                      {videos.find((v) => v.id === e.videoId)?.title ??
                        e.videoId}
                      <ArrowUpRight size={14} />
                    </button>
                  </article>
                ))}
              </div>
              {!filtered.length && (
                <div className="empty-state">
                  <BookOpen size={36} />
                  <h2>
                    {entries.length
                      ? "No matching expressions."
                      : "Your notebook starts with a spark."}
                  </h2>
                  <p>
                    {entries.length
                      ? "Try another search or filter."
                      : "Open a video and save your first expression from its transcript."}
                  </p>
                  <button className="primary" onClick={() => nav("library")}>
                    Explore your videos <ArrowUpRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {page === "review" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    A LITTLE REPETITION. A LASTING IMPRESSION.
                  </div>
                  <h1>Make the words yours.</h1>
                  <p>Recall the meaning, then turn the card over to check.</p>
                </div>
                <span className="review-counter">
                  {reviewed} reviewed this session
                </span>
              </div>
              {card ? (
                <div className="review-wrap">
                  <div className="review-progress">
                    <span>
                      EXPRESSION {reviewIndex + 1} OF {reviewEntries.length}
                    </span>
                    <span>{card.status}</span>
                  </div>
                  <div className="flashcard">
                    <span className="eyebrow">
                      {flipped ? "THE MEANING" : "DO YOU REMEMBER?"}
                    </span>
                    <h2>
                      {flipped
                        ? card.analysis?.contextMeaning ||
                          card.definition ||
                          "No meaning added yet. Edit this entry in your notebook."
                        : card.selection || card.sentence}
                    </h2>
                    {flipped ? (
                      <>
                        <p>{card.notes}</p>
                        <div className="tags">
                          {card.tags.map((t) => (
                            <span key={t}>{t}</span>
                          ))}
                        </div>
                        <button
                          className="text-button"
                          onClick={() =>
                            void run(async () => {
                              const v = await db.videos.get(card.videoId);
                              if (v) await openVideo(v, card.timestampMs);
                            })
                          }
                        >
                          Replay in context · {timestamp(card.timestampMs)} ↗
                        </button>
                      </>
                    ) : (
                      card.selection && <p>“{card.sentence}”</p>
                    )}
                    <button
                      className="secondary"
                      onClick={() => setFlipped(!flipped)}
                    >
                      {flipped ? "Show expression" : "Reveal meaning"}{" "}
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                  {flipped && (
                    <div className="review-actions">
                      <button
                        className="secondary"
                        onClick={() => grade("learning")}
                      >
                        Keep practicing
                      </button>
                      <button
                        className="primary"
                        onClick={() => grade("known")}
                      >
                        <Check size={17} />I know this
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <Check size={38} />
                  <h2>
                    {reviewed
                      ? "A little more confident."
                      : "You’re all caught up."}
                  </h2>
                  <p>
                    {reviewed
                      ? `You practiced ${reviewed} expression${reviewed === 1 ? "" : "s"} today.`
                      : "Save new expressions or mark an entry as learning to practice it here."}
                  </p>
                  <button className="primary" onClick={() => nav("notebook")}>
                    Back to notebook
                  </button>
                </div>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ALWAYS IN YOUR HANDS</div>
                  <h1>Your space. Your data.</h1>
                  <p>A small workspace, with nothing locked away.</p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="settings-card">
                  <span className="stat-icon sage">
                    <Download size={23} />
                  </span>
                  <h2>Take your learning with you.</h2>
                  <p>
                    Export videos, transcripts, notebook entries, and
                    preferences in a versioned JSON backup.
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      void run(async () => {
                        download(
                          new Blob(
                            [JSON.stringify(await exportBackup(), null, 2)],
                            { type: "application/json" },
                          ),
                          `verbatim-${new Date().toISOString().slice(0, 10)}.json`,
                        );
                      })
                    }
                  >
                    <Download size={16} />
                    Export backup
                  </button>
                  <hr />
                  <h3>Restore a collection</h3>
                  <p>
                    Import merges records by ID. Matching records are updated;
                    other existing records are kept. Invalid backups are
                    rejected before any data is written.
                  </p>
                  <label className="secondary import-button">
                    <Upload size={16} />
                    Import JSON backup
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f)
                          void run(async () => {
                            if (f.size > 25_000_000)
                              throw new Error(
                                "Choose a backup smaller than 25 MB.",
                              );
                            const data = validateBackup(
                              JSON.parse(await f.text()),
                            );
                            if (
                              window.confirm(
                                `Import ${data.videos.length} videos and ${data.entries.length} notebook entries? Matching IDs will be updated.`,
                              )
                            ) {
                              await importBackup(data);
                              setNotice("Your collection was restored.");
                            }
                          });
                      }}
                    />
                  </label>
                </section>
                <div>
                  <GeminiSettings />
                  <section className="settings-card privacy-card">
                    <Leaf size={24} />
                    <h2>Local by default.</h2>
                    <p>
                      Your videos, transcripts, notes and exercise history live
                      in a SQLite database on this device. Export regularly to
                      keep a backup.
                    </p>
                    <p>
                      YouTube playback and thumbnails contact Google. Meaning
                      analysis and exercise generation send the selected study
                      material to Gemini only when requested. Your API key is
                      encrypted by the operating system and excluded from
                      backups. No analytics or sign-in.
                    </p>
                    <p>
                      Opening a video automatically requests English captions
                      through a local service. When captions are absent, Whisper
                      transcribes accessible audio on your computer. YouTube
                      receives the video request; speech recognition does not
                      send audio to a paid AI service. The model downloads on
                      first use. Only process videos you have permission to use.
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
      {draft && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDraft(null);
          }}
        >
          <section
            className="editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              if (e.key === "Tab") {
                const nodes = Array.from(
                  e.currentTarget.querySelectorAll<HTMLElement>(
                    "button:not(:disabled),input,textarea,select",
                  ),
                );
                const first = nodes[0],
                  last = nodes.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <div className="editor-heading">
              <div>
                <span className="eyebrow">WORDS WORTH KEEPING</span>
                <h2 id="editor-title">Make a little discovery.</h2>
              </div>
              <button
                autoFocus
                aria-label="Close editor"
                onClick={() => setDraft(null)}
              >
                <X size={21} />
              </button>
            </div>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <form onSubmit={saveEntry}>
              <label className="field">
                Expression
                <input
                  value={draft.selection ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      selection: e.target.value,
                      analysis: undefined,
                    })
                  }
                  placeholder="A word or phrase (optional)"
                />
              </label>
              <label className="field">
                Source sentence
                <textarea
                  required
                  value={draft.sentence}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sentence: e.target.value,
                      analysis: undefined,
                    })
                  }
                />
              </label>
              <div className="lookup-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void analyze()}
                >
                  {busy ? "Understanding…" : "Analyze meaning & grammar"}{" "}
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <small className="helper">
                Gemini 2.5 Flash-Lite · Definitions and explanations in English.
              </small>
              {lookup && (
                <p className="lookup-result" role="status">
                  {lookup}
                </p>
              )}
              {draft.analysis && <Meaning analysis={draft.analysis} />}
              <label className="field">
                Definition
                <input
                  value={draft.definition ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, definition: e.target.value })
                  }
                  placeholder="An English definition"
                />
              </label>
              <label className="field">
                Personal notes
                <textarea
                  value={draft.notes ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                  placeholder="What makes this useful to you?"
                />
              </label>
              <label className="field">
                Tags & grammar{" "}
                <span className="helper">Separate with commas</span>
                <input
                  value={draft.tags.join(",")}
                  onChange={(e) =>
                    setDraft({ ...draft, tags: e.target.value.split(",") })
                  }
                  placeholder="phrasal verb, everyday English"
                  list="existing-tags"
                />
                <datalist id="existing-tags">
                  {allTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                Progress
                <select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as NotebookEntry["status"],
                    })
                  }
                >
                  <option value="new">New discovery</option>
                  <option value="learning">Learning</option>
                  <option value="known">Known</option>
                </select>
              </label>
              <div className="editor-footer">
                <span>
                  {timestamp(draft.timestampMs)} · Linked to your video
                </span>
                <button className="primary" type="submit" disabled={busy}>
                  <Plus size={17} />
                  Save expression
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
  function grade(next: NotebookEntry["status"]) {
    if (!card) return;
    void run(async () => {
      await db.entries.update(card.id, {
        status: next,
        updatedAt: new Date().toISOString(),
      });
      setReviewed((n) => n + 1);
      setReviewIndex((n) => n + 1);
      setFlipped(false);
    });
  }
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
