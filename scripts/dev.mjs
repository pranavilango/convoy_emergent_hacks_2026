// `npm run dev`: the Next.js site plus the Rust allocation engine that its Analyze button calls.
//
// - If an engine already answers on MEDROUTE_API_URL (default http://127.0.0.1:8080), it's reused.
// - Otherwise `cargo run --release` starts one here, its output prefixed with [engine].
// - If Rust isn't installed, the site still starts, with instructions for Analyze.
// Ctrl+C stops both. `npm run dev:web` / `npm run dev:engine` run either on its own.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const engineUrl = (process.env.MEDROUTE_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const children = [];

function prefix(stream, label) {
  let buffered = "";
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) process.stdout.write(`[${label}] ${line}\n`);
  });
}

async function engineIsUp() {
  try {
    const res = await fetch(`${engineUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findCargo() {
  const local = join(
    homedir(),
    ".cargo",
    "bin",
    process.platform === "win32" ? "cargo.exe" : "cargo",
  );
  return existsSync(local) ? local : "cargo";
}

function stopAll(code = 0) {
  for (const child of children) if (!child.killed) child.kill("SIGINT");
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

if (await engineIsUp()) {
  console.log(`[engine] already running at ${engineUrl}, reusing it.`);
} else {
  const engine = spawn(findCargo(), ["run", "--release"], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(engine);
  prefix(engine.stdout, "engine");
  prefix(engine.stderr, "engine");
  engine.on("error", () => {
    console.log(
      "[engine] Rust isn't installed, so Analyze won't work. Install it from https://rustup.rs, then run `npm run dev` again.",
    );
  });
  engine.on("exit", (code) => {
    if (code)
      console.log(`[engine] stopped (exit ${code}). Analyze needs it; see the lines above.`);
  });
}

const web = spawn(process.execPath, [join("node_modules", "next", "dist", "bin", "next"), "dev"], {
  stdio: "inherit",
});
children.push(web);
web.on("exit", (code) => stopAll(code ?? 0));
