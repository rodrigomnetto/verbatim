const { DatabaseSync } = require("node:sqlite");
const TABLES = ["videos", "entries", "transcripts", "settings", "sessions"];
class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    for (const t of TABLES)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      );
    this.db.exec("PRAGMA user_version=1");
  }
  table(t) {
    if (!TABLES.includes(t)) throw new Error("Invalid table");
    return t;
  }
  list(t) {
    return this.db
      .prepare(`SELECT data FROM ${this.table(t)}`)
      .all()
      .map((r) => JSON.parse(r.data));
  }
  put(t, record) {
    if (
      !record ||
      typeof record.id !== "string" ||
      !record.id ||
      JSON.stringify(record).length > 15000000
    )
      throw new Error("Invalid record");
    this.db
      .prepare(
        `INSERT INTO ${this.table(t)} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(record.id, JSON.stringify(record));
  }
  delete(t, id) {
    this.db.prepare(`DELETE FROM ${this.table(t)} WHERE id=?`).run(id);
  }
  batch(records) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [t, rows] of Object.entries(records)) {
        this.table(t);
        if (!Array.isArray(rows)) throw new Error("Invalid records");
        for (const r of rows) this.put(t, r);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  backup() {
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      ...Object.fromEntries(
        TABLES.filter((t) => t !== "settings").map((t) => [t, this.list(t)]),
      ),
      settings: this.list("settings").filter((r) => r.id === "preferences"),
    };
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store };
