const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules", "electron", "install.js")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      electron_config_cache: path.join(root, ".cache", "electron"),
    },
  },
);
process.exit(result.status ?? 1);
