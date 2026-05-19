import { readFileSync, writeFileSync, existsSync, createReadStream } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { isEmpty } from "lodash-es";
import { guohub_logger, guohub_json_print, guohub_error_print, guohub_text_print, guohub_success_print } from "#common_js/log.js";
import { getCredential, setCredential, deleteCredential } from "#common_js/keyring_helper.js";
import { readClipboard } from "#common_js/clipboard.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(HERE, "config.toml");

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

function saveConfig(config: Record<string, unknown>) {
  writeFileSync(CONFIG_PATH, stringify(config));
}

function accountKey(account: string, key: string): string {
  return `email-${key}-${account}`;
}

function validateAccount(account: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(account)) {
    guohub_error_print("账户名只允许英文、数字、连字符(-)和下划线(_)，不允许等号等特殊字符");
  }
}

function getAccountConfig(config: Record<string, unknown>, account: string): Record<string, unknown> | null {
  const accounts = config.accounts as Record<string, Record<string, unknown>> | undefined;
  if (!accounts || !accounts[account]) return null;
  return accounts[account];
}

async function setup(account: string, host: string, port: number, fromAddr: string, password: string, fromName?: string, useTls?: boolean, to?: string[]) {
  validateAccount(account);
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;

  accounts[account] = {
    smtp_host: host,
    smtp_port: port,
    from_addr: fromAddr,
    ...(fromName ? { from_name: fromName } : {}),
    use_tls: useTls !== false,
    ...(to && to.length > 0 ? { to } : {}),
  };

  config.accounts = accounts;
  if (!config.defaults) config.defaults = {};
  (config.defaults as Record<string, unknown>).default_account = account;

  saveConfig(config);
  await setCredential(accountKey(account, "password"), password);

  guohub_text_print(`邮件账户 "${account}" 配置完成`);
}

async function send(account: string, to: string[], subject: string, body: string, html?: boolean, attachments?: string[]) {
  const config = loadConfig();
  const acc = getAccountConfig(config, account);
  if (!acc) guohub_error_print(`邮件账户 "${account}" 不存在，请先运行 setup`);

  const host = String(acc.smtp_host);
  const port = Number(acc.smtp_port);
  const fromAddr = String(acc.from_addr);
  const fromName = acc.from_name ? String(acc.from_name) : fromAddr;
  const useTls = acc.use_tls !== false;

  // 如果没有传 --to，使用账户配置的默认收件人
  const defaultTo = acc.to as string[] | undefined;
  const finalTo = to.length > 0 ? to : (defaultTo ?? []);
  if (isEmpty(finalTo)) guohub_error_print(`账户 "${account}" 未配置默认收件人，请用 --to 指定`);

  const password = await getCredential(accountKey(account, "password"));
  if (!password) guohub_error_print(`账户 "${account}" 的 SMTP 密码未配置`);

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    ...(useTls && port !== 465 ? { requireTLS: true } : {}),
    auth: { user: fromAddr, pass: password },
  });

  const mailOptions: Record<string, unknown> = {
    from: `"${fromName}" <${fromAddr}>`,
    to: finalTo.join(", "),
    subject,
    ...(html ? { html: body } : { text: body }),
  };

  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments.map(path => ({
      filename: basename(path),
      content: createReadStream(path),
    }));
  }

  guohub_logger.info(`发送邮件到 ${finalTo.join(", ")}${attachments?.length ? ` (${attachments.length} 个附件)` : ""} ...`);
  const info = await transporter.sendMail(mailOptions);

  guohub_json_print({ message_id: info.messageId, accepted: info.accepted, rejected: info.rejected });
}

async function listAccounts() {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  const defaultAccount = (config.defaults as Record<string, unknown> | undefined)?.default_account as string | undefined;

  const list = Object.entries(accounts).map(([name, acc]) => ({
    name,
    smtp_host: acc.smtp_host,
    smtp_port: acc.smtp_port,
    from_addr: acc.from_addr,
    from_name: acc.from_name,
    use_tls: acc.use_tls,
    to: acc.to,
    is_default: name === defaultAccount,
  }));

  guohub_json_print(list);
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
  await deleteCredential(accountKey(account, "password"));

  guohub_text_print(`账户 "${account}" 已删除`);
}

async function updateAccount(account: string, fromName?: string, to?: string[]) {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  if (fromName !== undefined) accounts[account].from_name = fromName;
  if (to !== undefined) accounts[account].to = to;

  config.accounts = accounts;
  saveConfig(config);

  const changes: string[] = [];
  if (fromName !== undefined) changes.push(`from_name="${fromName}"`);
  if (to !== undefined) changes.push(`to=[${to.join(", ")}]`);
  guohub_text_print(`账户 "${account}" 已更新: ${changes.join(", ")}`);
}

async function addContact(account: string, name: string, email: string) {
  validateAccount(account);
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  const contacts = (accounts[account].contacts ?? {}) as Record<string, string>;
  contacts[name] = email;
  accounts[account].contacts = contacts;
  config.accounts = accounts;
  saveConfig(config);

  guohub_text_print(`通讯录已添加: ${name} <${email}>`);
}

async function removeContact(account: string, name: string) {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  const contacts = (accounts[account].contacts ?? {}) as Record<string, string>;
  if (!contacts[name]) guohub_error_print(`联系人 "${name}" 不存在`);

  delete contacts[name];
  accounts[account].contacts = contacts;
  config.accounts = accounts;
  saveConfig(config);

  guohub_text_print(`联系人 "${name}" 已删除`);
}

async function listContacts(account: string) {
  const config = loadConfig();
  const accounts = (config.accounts ?? {}) as Record<string, Record<string, unknown>>;
  if (!accounts[account]) guohub_error_print(`账户 "${account}" 不存在`);

  const contacts = (accounts[account].contacts ?? {}) as Record<string, string>;
  guohub_json_print({ account, contacts });
}

function resolveContacts(account: string, toNames: string[]): string[] {
  const config = loadConfig();
  const acc = getAccountConfig(config, account);
  if (!acc) return toNames;

  const contacts = (acc.contacts ?? {}) as Record<string, string>;
  const defaultTo = acc.to as string[] | undefined;
  const result: string[] = [];

  for (const name of toNames) {
    if (contacts[name]) {
      result.push(contacts[name]);
    } else if (name.includes("@")) {
      result.push(name);
    } else if (name === "default" && defaultTo) {
      result.push(...defaultTo);
    }
  }

  return result;
}

export async function main(args: string[]) {
  let account = "";
  let host = "";
  let port = 587;
  let fromAddr = "";
  let fromName = "";
  let password = "";
  let useTls = true;
  let to: string[] = [];
  let subject = "";
  let body = "";
  let html = false;
  let contactName = "";
  let contactEmail = "";
  let attachments: string[] = [];
  let passwordFromClipboard = false;

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--host": host = args[++i]; break;
      case "--port": port = parseInt(args[++i]); break;
      case "--from": fromAddr = args[++i]; break;
      case "--from-name": fromName = args[++i]; break;
      case "--password": password = args[++i]; break;
      case "--from-clipboard": passwordFromClipboard = true; break;
      case "--no-tls": useTls = false; break;
      case "--to": to.push(args[++i]); break;
      case "--subject": subject = args[++i]; break;
      case "--body": body = args[++i]; break;
      case "--html": html = true; break;
      case "--attach": attachments.push(args[++i]); break;
      case "--name": contactName = args[++i]; break;
      case "--email": contactEmail = args[++i]; break;
      default: positional.push(args[i]);
    }
  }

  const command = positional[0];

  if (passwordFromClipboard && !password) {
    password = readClipboard().trim();
  }

  // 自动从 config.toml 读取默认账户
  if (!account && command !== "setup") {
    const config = loadConfig();
    const defaults = config.defaults as Record<string, unknown> | undefined;
    if (defaults?.default_account) account = String(defaults.default_account);
  }

  try {
    switch (command) {
      case "setup": {
        if (isEmpty(host) || isEmpty(fromAddr) || isEmpty(password)) {
          guohub_error_print("用法: email-sender setup --account <名称> --host <SMTP服务器> --port <端口> --from <发件地址> --password <密码> [--from-clipboard] [--from-name <名称>] [--no-tls] [--to <默认收件人>]");
        }
        await setup(account || "default", host, port, fromAddr, password, fromName || undefined, useTls, to.length > 0 ? to : undefined);
        break;
      }
      case "send": {
        if (isEmpty(account)) guohub_error_print("未指定账户且无默认账户，请用 --account 指定或先 setup");
        if (isEmpty(subject)) guohub_error_print("请提供 --subject 邮件主题");
        if (isEmpty(body)) guohub_error_print("请提供 --body 邮件内容");
        const resolvedTo = resolveContacts(account, to);
        await send(account, resolvedTo, subject, body, html, attachments.length > 0 ? attachments : undefined);
        break;
      }
      case "list":
        await listAccounts();
        break;
      case "update": {
        if (isEmpty(account)) guohub_error_print("用法: email-sender update --account <名称> [--from-name <新名称>] [--to <默认收件人>]");
        await updateAccount(account, fromName || undefined, to.length > 0 ? to : undefined);
        break;
      }
      case "remove": {
        if (isEmpty(account)) guohub_error_print("用法: email-sender remove --account <名称>");
        await removeAccount(account);
        break;
      }
      case "add-contact": {
        if (isEmpty(account)) guohub_error_print("用法: email-sender add-contact --account <名称> --name <联系人> --email <地址>");
        if (isEmpty(contactName)) guohub_error_print("请提供 --name 联系人名称");
        if (isEmpty(contactEmail)) guohub_error_print("请提供 --email 联系人邮箱");
        await addContact(account, contactName, contactEmail);
        break;
      }
      case "remove-contact": {
        if (isEmpty(account)) guohub_error_print("用法: email-sender remove-contact --account <名称> --name <联系人>");
        if (isEmpty(contactName)) guohub_error_print("请提供 --name 联系人名称");
        await removeContact(account, contactName);
        break;
      }
      case "list-contacts": {
        if (isEmpty(account)) guohub_error_print("用法: email-sender list-contacts --account <名称>");
        await listContacts(account);
        break;
      }
      default:
        guohub_error_print("用法: email-sender <setup|send|list|update|remove|add-contact|remove-contact|list-contacts> [选项]");
    }
  } catch (e: any) {
    guohub_error_print(`错误: ${e.message}`);
  }
}
