#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rawEntry = process.argv[1] || "";
const entryName = basename(rawEntry).toLowerCase();
const projectDir = dirname(fileURLToPath(import.meta.url)).toLowerCase();

// 只有直接调用项目内的 bin.js 才检测（排除全局 guohub-cli、npx wrapper 等）
const isDirectProjectCall =
  entryName === "bin.js" &&
  (rawEntry === "bin.js" || rawEntry === "./bin.js" || rawEntry.toLowerCase().startsWith(projectDir));

if (isDirectProjectCall) {
  try {
    execFileSync(
      process.platform === "win32" ? "where" : "which",
      ["guohub-cli"],
      { encoding: "utf8", stdio: "pipe" }
    );
  } catch {
    console.warn(
      "\x1b[33m⚠️  guohub-cli 未注册为全局命令，建议执行：npm link\x1b[0m"
    );
  }
}

const dir = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const tsxEsm = join(dir, "node_modules", "tsx", "dist", "cli.mjs");
try {
  execFileSync(node, [tsxEsm, join(dir, "cli.ts"), ...process.argv.slice(2)], {
    cwd: dir,
    stdio: "inherit",
    env: process.env,
  });
} catch (e) {
  if (e.status != null) process.exit(e.status);
  throw e;
}
