import { spawn } from "node:child_process";
import { createServer } from "vite";
const server = await createServer();
await server.listen();
const child = spawn("electron", [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VERBATIM_DEV: "1" },
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
