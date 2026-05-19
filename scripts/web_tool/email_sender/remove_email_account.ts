import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { isEmpty } from "lodash-es";
import { guohub_text_print, guohub_error_print } from "#common_js/log.js";
import { deleteCredential } from "#common_js/keyring_helper.js";

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

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
    }
  }

  if (isEmpty(account)) guohub_error_print("用法: remove-email-account --account <账户名>");

  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  // 收集要删除的 keyring 条目
  const acc = accounts[account];
  const keys = (acc.keys ?? []) as string[];
  const keysToDelete = ["password", ...keys];

  // 从 config.toml 移除账户
  delete accounts[account];
  config.accounts = accounts;

  const defaults = config.defaults as Record<string, unknown> | undefined;
  if (defaults?.default_account === account) delete defaults.default_account;

  saveConfig(config);

  // 从 keyring 删除所有凭据
  for (const key of keysToDelete) {
    await deleteCredential(`email-${key}-${account}`);
  }

  guohub_text_print(`账户 "${account}" 已删除，${keysToDelete.length} 条凭据已从 keyring 清理`);
}
