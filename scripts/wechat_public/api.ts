import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { guohub_error_print } from "#common_js/log.js";
import { getCredential } from "#common_js/keyring_helper.js";

const ROOT = process.env.GUOHUB_ROOT!;
const CONFIG_PATH = join(ROOT, "scripts", "wechat_public", "config.toml");
const TOKEN_CACHE_PATH = join(ROOT, "scripts", "wechat_public", "local_data", "wechat_token_cache.json");
const API_BASE = "https://api.weixin.qq.com/cgi-bin";

interface TokenCache {
  [account: string]: { token: string; expires_at: number };
}

export function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
}

function loadTokenCache(): TokenCache {
  if (!existsSync(TOKEN_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE_PATH, "utf-8")) as TokenCache;
  } catch {
    return {};
  }
}

function saveTokenCache(cache: TokenCache) {
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
}

export async function getAccessToken(account: string): Promise<string> {
  const config = loadConfig();
  const accounts = config.accounts as Record<string, Record<string, unknown>> | undefined;
  if (!accounts || !accounts[account]) {
    guohub_error_print(`微信账户 "${account}" 不存在，请先运行 wechat-account setup`);
  }

  const appid = String(accounts![account].appid ?? "");
  const appsecret = await getCredential(`wechat-secret-${account}`);

  if (!appid || !appsecret) {
    guohub_error_print(`账户 "${account}" 凭据不完整`);
  }

  const cache = loadTokenCache();
  const cached = cache[account];
  if (cached && cached.expires_at > Date.now() / 1000) {
    return cached.token;
  }

  const resp = await fetch(
    `${API_BASE}/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`
  );
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode) {
    guohub_error_print(
      `获取 access_token 失败: ${data.errmsg} (errcode: ${data.errcode})`
    );
  }

  const token = String(data.access_token);
  const expiresIn = Number(data.expires_in) || 7200;
  cache[account] = { token, expires_at: Date.now() / 1000 + expiresIn - 300 };
  saveTokenCache(cache);

  return token;
}

export async function uploadImage(
  account: string,
  imageBuffer: Buffer,
  filename: string
): Promise<Record<string, unknown>> {
  const token = await getAccessToken(account);
  const boundary = `----WechatFormBoundary${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    "utf-8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  const body = Buffer.concat([head, imageBuffer, tail]);

  const resp = await fetch(
    `${API_BASE}/material/add_material?access_token=${token}&type=image`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    }
  );

  return (await resp.json()) as Record<string, unknown>;
}

export async function listMaterials(
  account: string,
  type: string
): Promise<Array<Record<string, unknown>>> {
  const token = await getAccessToken(account);
  const resp = await fetch(
    `${API_BASE}/material/batchget_material?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, offset: 0, count: 20 }),
    }
  );
  const data = (await resp.json()) as Record<string, unknown>;
  if (data.errcode) {
    guohub_error_print(`获取素材列表失败: ${data.errmsg} (errcode: ${data.errcode})`);
  }
  return (data.item as Array<Record<string, unknown>>) || [];
}
