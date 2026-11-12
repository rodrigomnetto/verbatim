import { useEffect, useState } from "react";
import { call } from "../db/database";
export function GeminiSettings() {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{
    configured: boolean;
    secure: boolean;
  }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setStatus(await call("key-status"));
  }
  useEffect(() => {
    void refresh().catch((e) => setMessage(String(e)));
  }, []);
  async function save(value: string) {
    setBusy(true);
    setMessage("");
    try {
      await call("key-save", value);
      setKey("");
      await refresh();
      setMessage(value ? "API key saved securely." : "API key removed.");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Your English learning companion.</h2>
      <p>
        Gemini 2.5 Flash-Lite explains meaning, identifies grammar and creates
        practice questions.
      </p>
      <p className="key-status">
        {status?.configured
          ? "● API key configured"
          : "○ API key not configured"}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(key);
        }}
      >
        <label className="field">
          Gemini API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your Google AI Studio API key"
            required
            maxLength={256}
          />
        </label>
        <button
          className="primary"
          disabled={busy || !key.trim() || !status?.secure}
        >
          Save API key
        </button>
        {status?.configured && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void save("")}
          >
            Remove key
          </button>
        )}
      </form>
      {status && !status.secure && (
        <p role="alert">
          OS secure storage is unavailable. Unlock your system keychain to save
          a key.
        </p>
      )}
      <p role="status">{message}</p>
      <small>
        Use a Google AI Studio project on the free tier. Google controls model
        availability and quotas; the app cannot enforce your project's billing
        settings. Selected text is sent to Google; free-tier data may be used to
        improve Google's products.
      </small>
    </section>
  );
}
