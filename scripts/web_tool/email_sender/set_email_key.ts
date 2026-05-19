import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { isEmpty } from "lodash-es";
import { guohub_error_print, guohub_success_print } from "#common_js/log.js";
import { setCredential } from "#common_js/keyring_helper.js";

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.toml");

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

function saveConfig(config: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, stringify(config));
}

export async function main(args: string[]) {
  let account = "";
  let key = "";
  let value = "";
  let setValue = false;
  let fromClipboard = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--set-value": setValue = true; break;
      case "--from-clipboard": fromClipboard = true; break;
      case "--force": force = true; break;
      default:
        if (!key.startsWith("-") && !key) key = args[i];
        else if (!value) value = args[i];
        break;
    }
  }

  if (isEmpty(account)) guohub_error_print("用法: set-email-key --account <账户名> <key> [--set-value <值>] [--from-clipboard] [--force]");
  if (isEmpty(key)) guohub_error_print("请提供 key 名称");

  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;

  if (!accounts[account] && !force) {
    guohub_error_print(`账户 "${account}" 不存在，请先 setup 或使用 --force 强制创建`);
  }

  if (!accounts[account]) {
    accounts[account] = {};
    config.accounts = accounts;
  }

  const acc = accounts[account];
  const keys = (acc.keys ?? []) as string[];
  if (!keys.includes(key)) {
    keys.push(key);
    acc.keys = keys;
    config.accounts = accounts;
    saveConfig(config);
  }

  let finalValue = value;
  if (fromClipboard) {
    const { readClipboard } = await import("#common_js/clipboard.js");
    finalValue = readClipboard();
  } else if (setValue) {
    finalValue = value;
  } else {
    guohub_error_print("请提供 --set-value <值> 或 --from-clipboard");
  }

  await setCredential(`email-${key}-${account}`, finalValue);
  guohub_success_print();
}
