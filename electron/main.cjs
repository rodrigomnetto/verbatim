const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  shell,
  protocol,
  net,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { Store } = require("./store.cjs");
const { backup, session } = require("./backup.cjs");
const { generate, analysis, quiz } = require("./ai.cjs");
app.setName("Verbatim");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "verbatim",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
const smoke = process.argv.includes("--smoke-test");
if (smoke) {
  app.setPath(
    "userData",
    path.join(__dirname, "..", ".cache", "smoke-profile-" + process.pid),
  );
}
let store,
  win,
  transcribing = false,
  aiBusy = false,
  worker;
const dev = !app.isPackaged && process.env.VERBATIM_DEV === "1";
function secure() {
  return (
    safeStorage.isEncryptionAvailable() &&
    !(
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    )
  );
}
function key() {
  const row = store.list("settings").find((r) => r.id === "api-key");
  if (!row) return "";
  if (!secure()) throw new Error("Secure storage is unavailable.");
  return safeStorage.decryptString(Buffer.from(row.value, "base64"));
}
function transcription(id) {
  if (!/^[\w-]{11}$/.test(id)) throw new Error("Invalid video ID");
  if (transcribing)
    throw new Error(
      "Another video is being transcribed. Retry when it finishes.",
    );
  transcribing = true;
  return new Promise((resolve, reject) => {
    const cache = app.isPackaged
      ? path.join(app.getPath("userData"), "models")
      : path.join(app.getAppPath(), ".cache", "models");
    fs.mkdirSync(cache, { recursive: true });
    const python =
      process.env.VERBATIM_PYTHON ||
      path.join(app.getAppPath(), ".venv", "bin", "python");
    const script = path.join(
      app.isPackaged ? process.resourcesPath : app.getAppPath(),
      "server",
      "transcribe.py",
    );
    worker = execFile(
      python,
      [script, id],
      {
        timeout: 900000,
        maxBuffer: 15000000,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          HF_HOME: path.join(cache, "huggingface"),
          XDG_CACHE_HOME: cache,
          UV_CACHE_DIR: path.join(cache, "uv"),
        },
      },
      (error, stdout) => {
        transcribing = false;
        worker = null;
        try {
          const result = JSON.parse(stdout);
          if (error || result.error)
            throw new Error(result.error || "Transcription failed.");
          resolve(result.tracks);
        } catch (e) {
          reject(
            new Error(
              stdout
                ? e.message
                : "Local transcription needs Python dependencies. Run npm run setup:transcription; packaged apps require VERBATIM_PYTHON pointing to that environment.",
            ),
          );
        }
      },
    );
  });
}
ipcMain.handle("verbatim", async (event, method, payload) => {
  const url = event.senderFrame?.url || "";
  if (
    event.sender !== win?.webContents ||
    !event.senderFrame ||
    event.senderFrame !== win.webContents.mainFrame ||
    !(dev
      ? url.startsWith("http://127.0.0.1:5173/")
      : url.startsWith("verbatim://app/"))
  )
    throw new Error("Untrusted caller");
  switch (method) {
    case "list":
      return store
        .list(payload.table)
        .filter((r) => payload.table !== "settings" || r.id === "preferences");
    case "put":
      if (payload.table === "settings" && payload.record.id !== "preferences")
        throw new Error("Protected setting");
      if (payload.table === "entries" && payload.record.analysis)
        analysis.parse(payload.record.analysis);
      if (payload.table === "sessions") session.parse(payload.record);
      store.put(payload.table, payload.record);
      return;
    case "delete":
      if (payload.table === "settings") throw new Error("Protected setting");
      store.delete(payload.table, payload.id);
      return;
    case "batch":
      if (payload.settings?.some((r) => r.id !== "preferences"))
        throw new Error("Protected settings");
      for (const e of payload.entries || [])
        if (e.analysis) analysis.parse(e.analysis);
      for (const s of payload.sessions || [])
        quiz.parse({ questions: s.questions });
      store.batch(payload);
      return;
    case "backup":
      return store.backup();
    case "import": {
      const b = backup.parse(payload);
      store.batch({
        videos: b.videos,
        entries: b.entries,
        transcripts: b.transcripts,
        settings: b.settings,
        sessions: b.sessions,
      });
      return;
    }
    case "key-status":
      return {
        configured: !!store.list("settings").find((r) => r.id === "api-key"),
        secure: secure(),
      };
    case "key-save":
      if (typeof payload !== "string" || payload.length > 256)
        throw new Error("Invalid key");
      if (!payload.trim()) {
        store.delete("settings", "api-key");
        return;
      }
      if (!secure()) throw new Error("System secure storage is unavailable.");
      store.put("settings", {
        id: "api-key",
        value: safeStorage.encryptString(payload.trim()).toString("base64"),
      });
      return;
    case "analyze":
    case "quiz": {
      if (aiBusy)
        throw new Error("A Gemini request is already running. Please wait.");
      if (JSON.stringify(payload).length > 50000)
        throw new Error("Study material is too long. Select fewer lessons.");
      if (
        method === "analyze" &&
        (typeof payload.expression !== "string" ||
          !payload.expression.trim() ||
          typeof payload.context !== "string")
      )
        throw new Error("Enter an expression and context.");
      if (
        method === "quiz" &&
        (!Number.isInteger(payload.count) ||
          payload.count < 1 ||
          payload.count > 10 ||
          !["multiple-choice", "fill-in-the-blank"].includes(payload.type))
      )
        throw new Error("Invalid exercise settings");
      aiBusy = true;
      try {
        return await generate(
          key(),
          method === "analyze" ? "analyze" : "quiz",
          payload,
        );
      } finally {
        aiBusy = false;
      }
    }
    case "transcribe":
      return transcription(payload);
    default:
      throw new Error("Unknown action");
  }
});
app.whenReady().then(() => {
  store = new Store(path.join(app.getPath("userData"), "verbatim.sqlite"));
  protocol.handle("verbatim", (request) => {
    const u = new URL(request.url);
    const root = path.join(app.getAppPath(), "dist");
    const file = path.resolve(
      root,
      "." + decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname),
    );
    if (u.hostname !== "app" || !file.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  function create() {
    win = new BrowserWindow({
      show: !smoke,
      width: 1440,
      height: 960,
      minWidth: 1000,
      minHeight: 700,
      backgroundColor: "#f8f9f6",
      title: "Verbatim",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(www\.)?youtube\.com\//.test(url))
        void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
      if (
        !(dev
          ? url.startsWith("http://127.0.0.1:5173/")
          : url.startsWith("verbatim://app/"))
      )
        e.preventDefault();
    });
    win.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ["https://www.youtube.com/embed/*"] },
      (details, cb) =>
        cb({
          requestHeaders: {
            ...details.requestHeaders,
            Referer: "https://com.verbatim.desktop/",
          },
        }),
    );
    win.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
      cb(false),
    );
    if (smoke) {
      const timeout = setTimeout(() => {
        console.error("Smoke test timed out");
        app.exit(1);
      }, 30000);
      win.webContents.once("did-finish-load", async () => {
        try {
          await require("./smoke.cjs")(win);
          clearTimeout(timeout);
          app.quit();
        } catch (e) {
          console.error(e);
          app.exit(1);
        }
      });
    }
    void win.loadURL(dev ? "http://127.0.0.1:5173/" : "verbatim://app/");
  }
  create();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  worker?.kill();
  store?.close();
});
