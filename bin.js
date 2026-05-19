#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
