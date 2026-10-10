const { spawn } = require("node:child_process");

const port = process.env.PORT || "3000";
if (!/^\d+$/.test(port)) throw new Error("PORT debe ser un número válido");

const nextBin = require.resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "--hostname", "0.0.0.0", "--port", port], {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
