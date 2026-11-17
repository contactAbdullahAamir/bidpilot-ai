#!/usr/bin/env node
/**
 * One-command local development: builds the shared contracts, then runs the
 * API, AI orchestrator and web app together with prefixed, colored logs.
 * Ctrl+C stops everything.
 */
import { spawn, spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const shell = process.platform === "win32";

const build = spawnSync(npm, ["run", "build", "--workspace", "@bidpilot/contracts"], { stdio: "inherit", shell });
if (build.status !== 0) process.exit(build.status ?? 1);

const services = [
  { name: "api", color: 36, args: ["run", "dev", "--workspace", "@bidpilot/api"] },
  { name: "ai ", color: 35, args: ["run", "dev", "--workspace", "@bidpilot/ai-orchestrator"] },
  { name: "web", color: 32, args: ["run", "dev", "--workspace", "@bidpilot/web"] }
];

const children = services.map(({ name, color, args }) => {
  const child = spawn(npm, args, { shell, env: { ...process.env, FORCE_COLOR: "1" } });
  const prefix = `\x1b[${color}m${name} │\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) target.write(prefix + line + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => process.stdout.write(`${prefix}exited with code ${code}\n`));
  return child;
});

setTimeout(() => {
  process.stdout.write("\n\x1b[1m  BidPilot AI is starting → http://localhost:3000\x1b[0m\n\n");
}, 4000);

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
