import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";

function loadConfig(): Record<string, unknown> {
  const root = process.env.GUOHUB_ROOT;
  const path = root ? `${root}/config.toml` : new URL("../../config.toml", import.meta.url).pathname;
  if (!existsSync(path)) return { keyring_namespace: "GUOHUB_CLI" };
  return parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

export const NAME_SPACE = String(loadConfig().keyring_namespace ?? "GUOHUB_CLI");
