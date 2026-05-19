import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEmpty } from "lodash-es";
import { guohub_logger, guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";
import { getAccessToken, listMaterials } from "./api.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEV_TEMP = join(HERE, "..", "..", "..", "dev_temp");
const API_BASE = "https://api.weixin.qq.com/cgi-bin";

function formatTime(ts: number): string {
  if (!ts) return "未知";
  return new Date(ts * 1000).toLocaleString("zh-CN");
}

async function list(account: string, type: string) {
  const mediaTypes = type === "all" ? ["image", "video", "news"] : [type];
  const result: Record<string, unknown> = {};

  for (const mt of mediaTypes) {
    const items = await listMaterials(account, mt);
    result[mt] = items.map((item, i) => ({
      name: item.name || `${mt}_${i + 1}`,
      media_id: item.media_id,
      update_time: formatTime(Number(item.update_time) || 0),
      url: item.url || undefined,
    }));
  }

  guohub_json_print(result);
}

async function download(account: string, mediaId: string, outputDir: string) {
  const token = await getAccessToken(account);
  const resp = await fetch(`${API_BASE}/material/get_material?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });

  const contentType = resp.headers.get("Content-Type") || "";

  if (contentType.includes("json") || contentType.includes("text")) {
    const err = await resp.json();
    guohub_error_print(`下载失败: ${JSON.stringify(err)}`);
  }

  const data = Buffer.from(await resp.arrayBuffer());
  let ext = ".jpg";
  if (contentType.includes("png")) ext = ".png";
  else if (contentType.includes("gif")) ext = ".gif";
  else if (contentType.includes("webp")) ext = ".webp";

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const filename = `${mediaId}${ext}`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, data);

  guohub_json_print({ media_id: mediaId, filename, size_kb: (data.length / 1024).toFixed(1), path: filepath });
}

async function remove(account: string, mediaId: string) {
  const token = await getAccessToken(account);
  const resp = await fetch(`${API_BASE}/material/del_material?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_id: mediaId }),
  });
  const data = (await resp.json()) as Record<string, unknown>;

  if (data.errcode === 0) {
    guohub_text_print(`已删除 ${mediaId}`);
  } else {
    guohub_error_print(`删除失败: ${JSON.stringify(data)}`);
  }
}

export async function main(args: string[]) {
  let account = "";
  let type = "all";
  let mediaId = "";
  let outputDir = "";

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--account": account = args[++i]; break;
      case "--type": type = args[++i]; break;
      case "--media-id": mediaId = args[++i]; break;
      case "--output": outputDir = args[++i]; break;
      default: positional.push(args[i]);
    }
  }

  const command = positional[0];

  if (!account) {
    const { loadConfig } = await import("./api.js");
    const config = loadConfig();
    const defaults = config.defaults as Record<string, unknown> | undefined;
    if (defaults?.default_account) account = String(defaults.default_account);
  }

  if (isEmpty(account)) guohub_error_print("未指定账户且无默认账户，请用 --account 指定或先 wechat-account setup");

  try {
    switch (command) {
      case "list": {
        await list(account, type);
        break;
      }
      case "download": {
        if (isEmpty(mediaId)) guohub_error_print("用法: wechat-material download --account <账户> --media-id <ID> [--output <目录>]");
        const dir = outputDir || join(DEV_TEMP, "wechat_cache", account);
        await download(account, mediaId, dir);
        break;
      }
      case "remove": {
        if (isEmpty(mediaId)) guohub_error_print("用法: wechat-material remove --account <账户> --media-id <ID>");
        await remove(account, mediaId);
        break;
      }
      default:
        guohub_error_print("用法: wechat-material <list|download|remove> [选项]");
    }
  } catch (e: any) {
    guohub_error_print(`错误: ${e.message}`);
  }
}
