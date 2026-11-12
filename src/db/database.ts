import { useEffect, useState } from "react";
import type {
  Video,
  CachedTranscript,
  NotebookEntry,
  Settings,
} from "../domain/models";
declare global {
  interface Window {
    verbatim: {
      call: <T = unknown>(method: string, payload?: unknown) => Promise<T>;
    };
  }
}
export const call = <T = unknown>(method: string, payload?: unknown) =>
  window.verbatim.call<T>(method, payload);
const changed = () => window.dispatchEvent(new Event("verbatim:changed"));
class Table<T extends { id: string }> {
  constructor(public name: string) {}
  toArray() {
    return call<T[]>("list", { table: this.name });
  }
  async get(id: string) {
    return (await this.toArray()).find((r) => r.id === id);
  }
  async put(record: T) {
    await call("put", { table: this.name, record });
    changed();
  }
  async bulkPut(records: T[]) {
    await call("batch", { [this.name]: records });
    changed();
  }
  async update(id: string, patch: Partial<T>) {
    const r = await this.get(id);
    if (r) await this.put({ ...r, ...patch });
  }
  async delete(id: string) {
    await call("delete", { table: this.name, id });
    changed();
  }
  orderBy(field: keyof T) {
    return {
      reverse: () => ({
        toArray: async () =>
          (await this.toArray()).sort((a, b) =>
            String(b[field] ?? "").localeCompare(String(a[field] ?? "")),
          ),
      }),
    };
  }
  where(field: keyof T) {
    return {
      equals: (value: unknown) => ({
        toArray: async () =>
          (await this.toArray()).filter((r) => r[field] === value),
        count: async () =>
          (await this.toArray()).filter((r) => r[field] === value).length,
      }),
    };
  }
}
export const db = {
  videos: new Table<Video>("videos"),
  entries: new Table<NotebookEntry>("entries"),
  transcripts: new Table<CachedTranscript>("transcripts"),
  settings: new Table<Settings>("settings"),
};
export function useLiveQuery<T>(
  query: () => Promise<T> | T,
  deps: unknown[],
): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let live = true;
    let version = 0;
    const load = () => {
      const current = ++version;
      void Promise.resolve()
        .then(query)
        .then((v) => {
          if (live && current === version) setValue(v);
        })
        .catch((e) =>
          window.dispatchEvent(
            new CustomEvent("verbatim:error", { detail: String(e) }),
          ),
        );
    };
    load();
    window.addEventListener("verbatim:changed", load);
    return () => {
      live = false;
      window.removeEventListener("verbatim:changed", load);
    };
  }, deps);
  return value;
}
export function notifyChanged() {
  changed();
}
