import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { timestamp } from "../utils/video";
interface Player {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allow: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  getVideoData(): { title?: string };
  destroy(): void;
}
declare global {
  interface Window {
    YT?: { Player: new (element: HTMLElement, options: unknown) => Player };
    onYouTubeIframeAPIReady?: () => void;
  }
}
let api: Promise<void> | undefined;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (api) return api;
  api = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => {
      api = undefined;
      reject(
        new Error(
          "YouTube could not load. Check your connection or content blocker.",
        ),
      );
    };
    document.head.append(script);
  });
  return api;
}
export function VideoPlayer({
  id,
  initialMs,
  seek,
  onTime,
  onTitle,
}: {
  id: string;
  initialMs: number;
  seek: { ms: number; nonce: number } | null;
  onTime: (ms: number) => void;
  onTitle: (title: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const callbacks = useRef({ onTime, onTitle });
  callbacks.current = { onTime, onTitle };
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(initialMs);
  const [error, setError] = useState("");
  const [rates, setRates] = useState([1]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    setReady(false);
    setError("");
    loadAPI()
      .then(() => {
        if (disposed || !host.current) return;
        const el = document.createElement("div");
        host.current.replaceChildren(el);
        player.current = new window.YT!.Player(el, {
          videoId: id,
          width: "100%",
          height: "100%",
          playerVars: {
            start: Math.floor(initialMs / 1000),
            origin: location.origin,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (disposed) return;
              setReady(true);
              const p = player.current!;
              setRates(p.getAvailablePlaybackRates());
              const title = p.getVideoData().title;
              if (title) callbacks.current.onTitle(title);
              timer = setInterval(() => {
                const ms = Math.round(p.getCurrentTime() * 1000);
                setPosition(ms);
                setPlaying(p.getPlayerState() === 1);
                callbacks.current.onTime(ms);
              }, 500);
            },
            onError: () =>
              setError(
                "This video cannot be played here. Try another video or open it on YouTube.",
              ),
          },
        });
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
      clearInterval(timer);
      player.current?.destroy();
      player.current = null;
    };
  }, [id]);
  useEffect(() => {
    if (ready && seek) player.current?.seekTo(seek.ms / 1000, true);
  }, [seek, ready]);
  return (
    <>
      <div className="player" ref={host} />
      {error && (
        <p className="error">
          {error}{" "}
          <a
            href={`https://www.youtube.com/watch?v=${id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open YouTube ↗
          </a>
        </p>
      )}
      <div className="player-controls">
        <button
          disabled={!ready}
          onClick={() =>
            playing ? player.current?.pauseVideo() : player.current?.playVideo()
          }
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <span>{timestamp(position)}</span>
        <span className="spacer" />
        <label>
          Speed{" "}
          <select
            aria-label="Playback speed"
            disabled={!ready}
            onChange={(e) =>
              player.current?.setPlaybackRate(Number(e.target.value))
            }
            defaultValue="1"
          >
            {rates.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
