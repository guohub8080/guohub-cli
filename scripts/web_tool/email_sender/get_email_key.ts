import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { isEmpty } from "lodash-es";
import { guohub_json_print, guohub_error_print } from "#common_js/log.js";
import { getCredential } from "#common_js/keyring_helper.js";

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.toml");

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

export async function main(args: string[]) {
  let account = "";
  let key = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      default:
        if (!key && !args[i].startsWith("-")) key = args[i];
        break;
    }
  }

  if (isEmpty(account)) guohub_error_print("用法: get-email-key --account <账户名> [key]");

  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  const acc = accounts[account];
  if (!acc) guohub_error_print(`账户 "${account}" 不存在`);

  const keys = (acc.keys ?? []) as string[];

  if (key) {
    const value = await getCredential(`email-${key}-${account}`);
    guohub_json_print({ account, key, value: value ?? null });
  } else {
    const result: Record<string, string | null> = {};
    for (const k of keys) {
      result[k] = await getCredential(`email-${k}-${account}`);
    }
    guohub_json_print({ account, keys: result });
  }
}
