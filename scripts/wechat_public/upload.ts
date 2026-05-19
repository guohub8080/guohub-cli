import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { isEmpty } from "lodash-es";
import { guohub_logger, guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";
import { readClipboard, writeClipboard, readClipboardImageAsync } from "#common_js/clipboard.js";
import { getAccessToken } from "./api.js";

const API_BASE = "https://api.weixin.qq.com/cgi-bin";
const SUPPORTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp"]);

function ensureExt(name: string, mimeType: string): string {
  const ext = extname(name).toLowerCase();
  if (SUPPORTED_EXTS.has(ext)) return name;
  const map: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/bmp": ".bmp" };
  return name + (map[mimeType] || ".jpg");
}

async function uploadForm(token: string, filename: string, data: Buffer, mimeType: string): Promise<Record<string, unknown>> {
  const name = ensureExt(filename, mimeType);
  const boundary = `----WeChatFormBoundary${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${name}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf-8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  const body = Buffer.concat([head, data, tail]);

  const resp = await fetch(`${API_BASE}/material/add_material?access_token=${token}&type=image`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return (await resp.json()) as Record<string, unknown>;
}

async function uploadFile(account: string, filepath: string, name?: string): Promise<Record<string, unknown>> {
  if (!existsSync(filepath)) guohub_error_print(`文件不存在: ${filepath}`);
  const ext = extname(filepath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) guohub_error_print(`不支持的格式: ${ext}（支持 ${[...SUPPORTED_EXTS].join(", ")}）`);

  const data = readFileSync(filepath);
  const mimeType = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".bmp" ? "image/bmp" : "image/jpeg";
  const token = await getAccessToken(account);
  return uploadForm(token, name || basename(filepath), data, mimeType);
}

async function uploadBytes(account: string, imageBytes: Buffer, filename: string, mimeType = "image/png"): Promise<Record<string, unknown>> {
  const token = await getAccessToken(account);
  return uploadForm(token, filename, imageBytes, mimeType);
}

async function uploadBase64(account: string, b64: string, filename: string): Promise<Record<string, unknown>> {
  const match = b64.match(/^data:image\/([\w+.-]+);base64,/);
  let mimeType = "image/jpeg";
  let base64Data = b64;
  if (match) {
    mimeType = `image/${match[1]}`;
    base64Data = b64.slice(match[0].length);
  }
  const data = Buffer.from(base64Data, "base64");
  return uploadBytes(account, data, filename, mimeType);
}

async function uploadUrl(account: string, imageUrl: string, filename?: string): Promise<Record<string, unknown>> {
  guohub_logger.info(`下载图片: ${imageUrl}`);
  const resp = await fetch(imageUrl);
  if (!resp.ok) guohub_error_print(`下载失败: ${resp.status} ${resp.statusText}`);
  const data = Buffer.from(await resp.arrayBuffer());
  const contentType = resp.headers.get("Content-Type") || "";
  const mimeType = contentType.split(";")[0].trim() || "image/jpeg";
  const name = filename || basename(new URL(imageUrl).pathname) || "image";
  return uploadBytes(account, data, name, mimeType);
}

function parseClipboard(): { type: "file" | "base64" | "url" | null; data: string } {
  const text = readClipboard().trim();
  if (!text) return { type: null, data: "" };

  if (text.startsWith("data:image/")) return { type: "base64", data: text };
  if (/^https?:\/\//.test(text)) return { type: "url", data: text };
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 100) return { type: "base64", data: `data:image/png;base64,${text}` };
  if (existsSync(text)) return { type: "file", data: text };

  return { type: null, data: text };
}

export async function main(args: string[]) {
  let account = "";
  let files: string[] = [];
  let fromClipboard = false;
  let fromUrl = "";
  let fromBase64 = "";
  let name = "";

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--file": files.push(args[++i]); break;
      case "--from-clipboard": fromClipboard = true; break;
      case "--url": fromUrl = args[++i]; break;
      case "--base64": fromBase64 = args[++i]; break;
      case "--name": name = args[++i]; break;
      default: positional.push(args[i]);
    }
  }

  // 位置参数也当作文件
  for (const p of positional) {
    if (!p.startsWith("-") && (existsSync(p) || p.startsWith("http"))) files.push(p);
  }

  // 自动读取默认账户
  if (!account) {
    const { loadConfig } = await import("./api.js");
    const config = loadConfig();
    const defaults = config.defaults as Record<string, unknown> | undefined;
    if (defaults?.default_account) account = String(defaults.default_account);
  }

  if (isEmpty(account)) guohub_error_print("未指定账户且无默认账户，请用 --account 指定或先 wechat-account setup");

  const results: { source: string; media_id?: string; url?: string; error?: string }[] = [];

  try {
    // 剪贴板模式
    if (fromClipboard) {
      const filename = name || "clipboard_image";

      // 先尝试读取图片
      const imageBuf = await readClipboardImageAsync();
      if (imageBuf) {
        guohub_logger.info("剪贴板检测到图片，上传中...");
        const result = await uploadBytes(account, imageBuf, filename, "image/png");
        if (result.media_id) {
          const url = String(result.url || "");
          writeClipboard(url);
          guohub_json_print({ source: "clipboard_image", media_id: result.media_id, url, copied: true });
        } else {
          guohub_error_print(`上传失败: ${JSON.stringify(result)}`);
        }
        return;
      }

      // 再尝试文本（URL/Base64/文件路径）
      const { type, data } = parseClipboard();
      if (!type) guohub_error_print("剪贴板内容无法识别为图片（支持图片、文件路径、URL、Base64）");

      guohub_logger.info(`剪贴板检测到 ${type}，上传中...`);

      let result: Record<string, unknown>;
      if (type === "file") result = await uploadFile(account, data, filename);
      else if (type === "url") result = await uploadUrl(account, data, filename);
      else result = await uploadBase64(account, data, filename);

      if (result.media_id) {
        const url = String(result.url || "");
        writeClipboard(url);
        guohub_json_print({ source: "clipboard", media_id: result.media_id, url, copied: true });
      } else {
        guohub_error_print(`上传失败: ${JSON.stringify(result)}`);
      }
      return;
    }

    // URL 模式
    if (fromUrl) {
      const filename = name || "url_image";
      guohub_logger.info(`下载并上传: ${fromUrl}`);
      const result = await uploadUrl(account, fromUrl, filename);

      if (result.media_id) {
        const url = String(result.url || "");
        writeClipboard(url);
        guohub_json_print({ source: fromUrl, media_id: result.media_id, url, copied: true });
      } else {
        guohub_error_print(`上传失败: ${JSON.stringify(result)}`);
      }
      return;
    }

    // Base64 模式
    if (fromBase64) {
      const filename = name || "base64_image";
      const result = await uploadBase64(account, fromBase64, filename);

      if (result.media_id) {
        const url = String(result.url || "");
        writeClipboard(url);
        guohub_json_print({ source: "base64", media_id: result.media_id, url, copied: true });
      } else {
        guohub_error_print(`上传失败: ${JSON.stringify(result)}`);
      }
      return;
    }

    // 文件模式
    if (files.length === 0) {
      guohub_error_print("用法: wechat-upload --account <账户> [--file <路径>] [--url <链接>] [--base64 <数据>] [--from-clipboard] [--name <名称>]");
    }

    for (const filepath of files) {
      if (filepath.startsWith("http")) {
        const result = await uploadUrl(account, filepath, name || basename(new URL(filepath).pathname));
        results.push({ source: filepath, media_id: String(result.media_id || ""), url: String(result.url || ""), error: result.errmsg ? String(result.errmsg) : undefined });
      } else {
        const result = await uploadFile(account, filepath, name);
        results.push({ source: basename(filepath), media_id: String(result.media_id || ""), url: String(result.url || ""), error: result.errmsg ? String(result.errmsg) : undefined });
      }
    }

    // 复制最后一个成功的 URL 到剪贴板
    const lastSuccess = results.filter(r => r.url).pop();
    if (lastSuccess?.url) writeClipboard(lastSuccess.url);

    guohub_json_print({ account, uploaded: results, copied_url: lastSuccess?.url || null });
  } catch (e: any) {
    guohub_error_print(`错误: ${e.message}`);
  }
}
