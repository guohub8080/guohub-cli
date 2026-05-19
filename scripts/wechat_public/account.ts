import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { isEmpty } from "lodash-es";
import { guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";
import { getCredential, setCredential, deleteCredential } from "#common_js/keyring_helper.js";
import { readClipboard } from "#common_js/clipboard.js";

const ROOT = process.env.GUOHUB_ROOT!;
const CONFIG_PATH = join(ROOT, "scripts", "wechat_public", "config.toml");

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

function saveConfig(config: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, stringify(config));
}

function accountSecretKey(account: string): string {
  return `wechat-secret-${account}`;
}

function validateAccount(account: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(account)) {
    guohub_error_print("账户名只允许英文、数字、连字符(-)和下划线(_)");
  }
}

async function setup(account: string, appId: string, appSecret: string, displayName?: string) {
  validateAccount(account);
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;

  accounts[account] = {
    appid: appId,
    ...(displayName ? { display_name: displayName } : {}),
  };
  config.accounts = accounts;
  if (!config.defaults) config.defaults = {};
  (config.defaults as Record<string, unknown>).default_account = account;

  saveConfig(config);
  await setCredential(accountSecretKey(account), appSecret);

  guohub_text_print(`微信账户 "${account}" 配置完成`);
}

async function listAccounts() {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  const defaultAccount = (config.defaults as Record<string, unknown> | undefined)?.default_account as string | undefined;

  const list: Record<string, unknown>[] = [];
  for (const [name, info] of Object.entries(accounts)) {
    const secret = await getCredential(accountSecretKey(name));
    list.push({
      name,
      display_name: info.display_name ?? name,
      appid: info.appid,
      has_secret: !!secret,
      is_default: name === defaultAccount,
    });
  }

  guohub_json_print(list);
}

async function updateAccount(account: string, appId?: string, appSecret?: string, displayName?: string) {
  validateAccount(account);
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  const changes: string[] = [];
  if (appId) {
    accounts[account].appid = appId;
    changes.push("appid");
  }
  if (appSecret) {
    await setCredential(accountSecretKey(account), appSecret);
    changes.push("appsecret");
  }
  if (displayName !== undefined) {
    accounts[account].display_name = displayName;
    changes.push("display_name");
  }

  config.accounts = accounts;
  saveConfig(config);

  guohub_text_print(`账户 "${account}" 已更新: ${changes.join(", ")}`);
}

async function removeAccount(account: string) {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  delete accounts[account];
  config.accounts = accounts;

  const defaults = config.defaults as Record<string, unknown> | undefined;
  if (defaults?.default_account === account) delete defaults.default_account;

  saveConfig(config);
  await deleteCredential(accountSecretKey(account));

  guohub_text_print(`账户 "${account}" 已删除`);
}

export async function main(args: string[]) {
  let account = "";
  let appId = "";
  let appSecret = "";
  let displayName = "";
  let secretFromClipboard = false;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--appid": appId = args[++i]; break;
      case "--appsecret": appSecret = args[++i]; break;
      case "--display-name": displayName = args[++i]; break;
      case "--from-clipboard": secretFromClipboard = true; break;
      default: positional.push(args[i]);
    }
  }

  if (secretFromClipboard && !appSecret) {
    appSecret = readClipboard().trim();
  }

  const command = positional[0];

  if (!account && command !== "setup") {
    const config = loadConfig();
    const defaults = config.defaults as Record<string, unknown> | undefined;
    if (defaults?.default_account) account = String(defaults.default_account);
  }

  try {
    switch (command) {
      case "setup": {
        if (isEmpty(appId) || isEmpty(appSecret)) {
          guohub_error_print("用法: wechat-account setup --account <名称> --appid <AppID> --appsecret <AppSecret> [--from-clipboard] [--display-name <显示名称>]\n\n获取方式:\n1. 登录 mp.weixin.qq.com\n2. 设置与开发 → 基本配置\n3. AppID 直接复制\n4. AppSecret 点「重置」，扫码后显示一次，务必保存\n\n提示: 用 --from-clipboard 从剪贴板读取 AppSecret，避免明文暴露");
        }
        await setup(account || "default", appId, appSecret, displayName || undefined);
        break;
      }
      case "list":
        await listAccounts();
        break;
      case "update": {
        if (isEmpty(account)) guohub_error_print("用法: wechat-account update --account <名称> [--appid <新ID>] [--appsecret <新Secret>] [--from-clipboard] [--display-name <新名称>]");
        await updateAccount(account, appId || undefined, appSecret || undefined, displayName || undefined);
        break;
      }
      case "remove": {
        if (isEmpty(account)) guohub_error_print("用法: wechat-account remove --account <名称>");
        await removeAccount(account);
        break;
      }
      default:
        guohub_error_print("用法: wechat-account <setup|list|update|remove> [选项]");
    }
  } catch (e: any) {
    guohub_error_print(`错误: ${e.message}`);
  }
}
