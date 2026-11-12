export function parseVideoId(input: string): string {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid YouTube URL or 11-character video ID.");
  }
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Use an HTTP or HTTPS YouTube URL.");
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "www.youtube-nocookie.com",
      "youtube-nocookie.com",
    ].includes(host)
  ) {
    id =
      url.pathname === "/watch"
        ? url.searchParams.get("v")
        : /^\/(embed|shorts|live)\//.test(url.pathname)
          ? url.pathname.split("/")[2]
          : null;
  }
  if (!id || !/^[\w-]{11}$/.test(id))
    throw new Error("That URL does not contain a supported YouTube video ID.");
  return id;
}
export function timestamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
