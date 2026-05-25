#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 入口合法性由 GUOHUB_CLI_ENTRY 环境变量传递给 cli.ts
// 所有通过 bin.js 的调用都是合法的（guohub-cli、pnpm dev、node bin.js）

const dir = dirname(fileURLToPath(import.meta.url));
const node = process.execPath;
const tsxEsm = join(dir, "node_modules", "tsx", "dist", "cli.mjs");
try {
  execFileSync(node, [tsxEsm, join(dir, "cli.ts"), ...process.argv.slice(2)], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, GUOHUB_CLI_ENTRY: "bin.js" },
  });
} catch (e) {
  if (e.status != null) process.exit(e.status);
  throw e;
}
