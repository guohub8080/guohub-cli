import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";

export function getConfigPath(): string {
  const root = process.env.GUOHUB_ROOT;
  if (root) return `${root}/config.toml`;
  return new URL("../../config.toml", import.meta.url).pathname;
}

export function loadConfig(): Record<string, unknown> {
  const path = getConfigPath();
  if (!existsSync(path)) return { defaults: {}, services: {} };
  return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}
