import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { defaultTo, isNil, isEmpty } from "lodash-es";
import { guohub_logger, guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "config.toml");

function loadConfig(): { rpc_host: string; rpc_port: number; rpc_key: string } | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const data = parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
  return {
    rpc_host: String(data.rpc_host ?? "127.0.0.1"),
    rpc_port: Number(data.rpc_port ?? 16800),
    rpc_key: String(data.rpc_key ?? ""),
  };
}

function saveConfig(config: { rpc_host: string; rpc_port: number; rpc_key: string }) {
  const lines = [
    `rpc_host = ${JSON.stringify(config.rpc_host)}`,
    `rpc_port = ${config.rpc_port}`,
    `rpc_key = ${JSON.stringify(config.rpc_key)}`,
    "",
  ];
  writeFileSync(CONFIG_PATH, lines.join("\n"));
}

function buildRpcUrl(): string {
  const config = loadConfig();
  if (!config) return "";
  return `http://${config.rpc_host}:${config.rpc_port}/jsonrpc`;
}

async function rpc(method: string, ...params: unknown[]) {
  const rpcUrl = buildRpcUrl();
  if (isEmpty(rpcUrl)) guohub_error_print("Motrix 尚未配置");
  const config = loadConfig();
  const token = config?.rpc_key ?? "";
  const u = new URL(rpcUrl);
  const url = `${u.protocol}//${u.host}${u.pathname}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params: [token ? `token:${token}` : "", ...params] }),
  });
  const data = await res.json();
  if (!isNil(data.error)) throw new Error(data.error.message);
  return data.result;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)}${units[i]}`;
}

async function setup(host: string, port: number, token: string) {
  const rpcHost = host || "127.0.0.1";
  const rpcPort = port || 16800;

  const rpcUrl = `http://${rpcHost}:${rpcPort}/jsonrpc`;
  guohub_logger.info(`测试连接 ${rpcHost}:${rpcPort} ...`);
  try {
    await rpc("aria2.getVersion", rpcUrl);
  } catch (e: any) {
    guohub_error_print(`连接失败: ${e.message}`);
  }
  saveConfig({ rpc_host: rpcHost, rpc_port: rpcPort, rpc_key: token });
  guohub_text_print("Motrix 配置完成");
}

async function addDownload(urls: string[], out?: string) {
  const opts: Record<string, string> = {};
  if (!isNil(out)) opts.out = out;
  const gid = await rpc("aria2.addUri", urls, opts) as string;
  guohub_json_print({ gid, status: "added", urls });
}

async function listDownloads() {
  const active = await rpc("aria2.tellActive", ["gid", "status", "totalLength", "completedLength", "downloadSpeed", "files"]) as Record<string, string>[];
  const waiting = await rpc("aria2.tellWaiting", 0, 100, ["gid", "status", "totalLength", "completedLength", "files"]) as Record<string, string>[];
  const stopped = await rpc("aria2.tellStopped", 0, 20, ["gid", "status", "totalLength", "completedLength", "files"]) as Record<string, string>[];

  const format = (t: Record<string, string>) => {
    const total = defaultTo(parseInt(t.totalLength), 0);
    const done = defaultTo(parseInt(t.completedLength), 0);
    const speed = defaultTo(parseInt(t.downloadSpeed), 0);
    const files = t.files ? JSON.parse(JSON.stringify(t.files)) as Record<string, string>[] : [];
    const name = files[0]?.path?.split("/").pop() ?? "?";
    return {
      gid: t.gid, status: t.status,
      name,
      progress: total > 0 ? `${formatBytes(done)}/${formatBytes(total)} (${(done * 100 / total).toFixed(1)}%)` : "?",
      ...(speed > 0 ? { speed: `${formatBytes(speed)}/s` } : {}),
    };
  };

  guohub_json_print({
    active: active.map(format),
    waiting: waiting.map(format),
    stopped: stopped.slice(0, 10).map(format),
  });
}

async function checkStatus(gid: string) {
  const status = await rpc("aria2.tellStatus", gid) as Record<string, string>;
  const total = defaultTo(parseInt(status.totalLength), 0);
  const done = defaultTo(parseInt(status.completedLength), 0);
  const speed = defaultTo(parseInt(status.downloadSpeed), 0);
  const files = status.files ? JSON.parse(JSON.stringify(status.files)) as Record<string, string>[] : [];
  guohub_json_print({
    gid: status.gid, status: status.status,
    progress: total > 0 ? `${formatBytes(done)}/${formatBytes(total)} (${(done * 100 / total).toFixed(1)}%)` : "?",
    speed: speed > 0 ? `${formatBytes(speed)}/s` : "0",
    path: files[0]?.path ?? "",
  });
}

export async function main(args: string[]) {
  let out = "";
  let host = "";
  let port = 0;
  let token = "";

  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-o": case "--out": out = args[++i]; break;
      case "--host": host = args[++i]; break;
      case "--port": port = parseInt(args[++i]); break;
      case "--token": token = args[++i]; break;
      default: positional.push(args[i]);
    }
  }

  const command = positional[0];

  if (!command || (command !== "setup" && isNil(loadConfig()))) {
    guohub_error_print("Motrix 尚未配置，请先运行: motrix-download setup [--host <地址>] [--port <端口>] [--token <密钥>]\n提示: 默认连接 127.0.0.1:16800，无需 token");
  }

  try {
    switch (command) {
      case "setup":
        await setup(host, port, token);
        break;
      case "add": {
        const urls = positional.slice(1).filter(u => u.startsWith("http"));
        if (isEmpty(urls)) guohub_error_print("用法: motrix-download add <url1> [url2...] [-o 文件名]");
        await addDownload(urls, isEmpty(out) ? undefined : out);
        break;
      }
      case "list":
        await listDownloads();
        break;
      case "status": {
        if (isEmpty(positional[1])) guohub_error_print("用法: motrix-download status <gid>");
        await checkStatus(positional[1]);
        break;
      }
      default:
        guohub_error_print("用法: motrix-download <setup|add|list|status> [选项]");
    }
  } catch (e: any) {
    guohub_error_print(`RPC 错误: ${e.message}`);
  }
}
