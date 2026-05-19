import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { guohub_logger, guohub_json_print, guohub_error_print } from "#common_js/log.js";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PROFILES_TOML = path.join(HERE, "config.toml");
const LOCAL_DATA_DIR = path.join(HERE, "local_data");

const PROCESS_NAMES = ["chrome", "chromium", "msedge", "edge", "brave"];

const BROWSER_PATHS: Record<string, Record<string, string[]>> = {
  chrome: {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  edge: {
    darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    win32: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
};

// ─── Config ──

function loadProfiles(): Record<string, unknown> {
  if (!fs.existsSync(PROFILES_TOML)) return {};
  const text = fs.readFileSync(PROFILES_TOML, "utf-8");
  return parseToml(text) as Record<string, unknown>;
}

function resolveUserDataDir(projectName: string): string {
  const dir = path.join(LOCAL_DATA_DIR, projectName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Browser discovery ──

function findBrowser(browserName: string): string {
  const candidates = BROWSER_PATHS[browserName]?.[process.platform] || [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  guohub_error_print(`找不到 ${browserName}，请手动指定路径：--browser-path <路径>`);
}

// ─── Network / CDP ──

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function queryCdpVersion(port: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 1000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function waitForCdp(port: number, timeout = 10000): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const info = await queryCdpVersion(port);
    if (info) return info;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// ─── PID / process discovery ──

function findPidListeningOnPort(port: number): number | null {
  if (process.platform !== "win32") {
    try {
      const result = child_process.execSync(
        `lsof -i :${port} -sTCP:LISTEN -t -n -P 2>/dev/null`,
        { encoding: "utf-8", timeout: 3000 },
      );
      const pid = parseInt(result.trim().split("\n")[0]);
      if (!isNaN(pid)) return pid;
    } catch { /* empty */ }
  }
  return null;
}

interface PsEntry { pid: number; command: string; args: string; }

function listProcesses(): PsEntry[] {
  try {
    const cmd = process.platform === "win32"
      ? `wmic process get ProcessId,CommandLine /format:list`
      : `ps -eo pid,args`;
    const output = child_process.execSync(cmd, { encoding: "utf-8", timeout: 5000 });

    if (process.platform === "win32") {
      const entries: PsEntry[] = [];
      const blocks = output.split(/\n\s*\n/);
      for (const block of blocks) {
        const pidMatch = block.match(/ProcessId=(\d+)/);
        const cmdMatch = block.match(/CommandLine=(.+)/);
        if (pidMatch && cmdMatch) {
          entries.push({ pid: parseInt(pidMatch[1]), command: cmdMatch[1], args: cmdMatch[1] });
        }
      }
      return entries;
    }

    return output.trim().split("\n").slice(1).map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: parseInt(match[1]), command: match[2], args: match[2] };
    }).filter(Boolean) as PsEntry[];
  } catch {
    return [];
  }
}

interface ExistingInstance { port: number; pid: number; browser: string; }

function findExistingInstance(userDataDir: string): ExistingInstance | null {
  const targetUd = path.resolve(userDataDir).toLowerCase();
  const procs = listProcesses();

  for (const proc of procs) {
    const cmdLower = proc.command.toLowerCase();
    if (!PROCESS_NAMES.some((k) => cmdLower.includes(k))) continue;
    if (cmdLower.includes("helper")) continue;

    const args = proc.args;
    let port: number | null = null;
    let procUd: string | null = null;

    for (const arg of args.split(/\s+/)) {
      if (arg.startsWith("--remote-debugging-port=")) {
        port = parseInt(arg.split("=")[1]);
      }
      if (arg.startsWith("--user-data-dir=")) {
        procUd = path.resolve(arg.split("=", 1)[1] || arg.substring(16)).toLowerCase();
      }
    }

    // Also handle args with = syntax in single token
    const portMatch = args.match(/--remote-debugging-port=(\d+)/);
    const udMatch = args.match(/--user-data-dir=(\S+)/);

    if (portMatch) port = parseInt(portMatch[1]);
    if (udMatch) procUd = path.resolve(udMatch[1]).toLowerCase();

    if (port && procUd === targetUd) {
      // Verify CDP is alive synchronously
      try {
        const result = child_process.execSync(
          `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${port}/json/version`,
          { encoding: "utf-8", timeout: 2000 },
        );
        if (result.trim() === "200") {
          const info = JSON.parse(
            child_process.execSync(`curl -s http://127.0.0.1:${port}/json/version`, {
              encoding: "utf-8", timeout: 2000,
            }),
          );
          return { port, pid: proc.pid, browser: info.Browser || "" };
        }
      } catch { /* CDP not alive */ }
    }
  }
  return null;
}

// ─── Lock files ──

function cleanLockFiles(userDataDir: string) {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const lockPath = path.join(userDataDir, name);
    if (fs.existsSync(lockPath)) {
      try {
        fs.unlinkSync(lockPath);
        guohub_logger.info(`清理残留锁文件: ${name}`);
      } catch { /* ignore */ }
    }
  }
}

// ─── Daemon ──

function isDaemonRunning(cdpPort: number, projectName: string): boolean {
  const procs = listProcesses();
  return procs.some((p) => {
    const cmd = p.args;
    return cmd.includes("browser_daemon") && cmd.includes(String(cdpPort)) && cmd.includes(projectName);
  });
}

async function startDaemon(cdpPort: number, chromePid: number, projectName: string): Promise<Record<string, string>> {
  const daemonScript = path.join(HERE, "browser_daemon.ts");
  if (!fs.existsSync(daemonScript)) return {};

  const root = process.env.GUOHUB_ROOT || "";
  const tsx = path.join(root, "node_modules", ".bin", "tsx");

  return new Promise((resolve) => {
    const proc = child_process.spawn(tsx, [daemonScript, String(cdpPort), String(chromePid), projectName], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      if (output.includes("\n")) {
        try {
          const info = JSON.parse(output.trim());
          proc.stdout.destroy();
          resolve(info);
        } catch {
          resolve({});
        }
      }
    });

    proc.on("error", () => resolve({}));

    setTimeout(() => {
      proc.stdout.destroy();
      resolve({});
    }, 10000);
  });
}

// ─── Open URL via CDP WebSocket ──

async function openUrlInExisting(cdpPort: number, url: string, tabIndex?: number, replace?: boolean) {
  const ws = await import("ws");

  // Get page targets
  const targetsResp = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  const targets = (await targetsResp.json() as Array<Record<string, unknown>>)
    .filter((t) => t.type === "page");

  if (tabIndex !== undefined) {
    if (tabIndex < 0 || tabIndex >= targets.length) {
      guohub_error_print(`标签页索引 ${tabIndex} 超出范围，当前共 ${targets.length} 个标签页`);
    }
    const target = targets[tabIndex];
    const pageWs = new ws.default(target.webSocketDebuggerUrl as string, { maxPayload: 10 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      pageWs.on("open", () => {
        pageWs.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }));
        pageWs.on("message", () => { pageWs.close(); resolve(); });
      });
      pageWs.on("error", reject);
      setTimeout(() => { pageWs.close(); resolve(); }, 3000);
    });
  } else {
    // Create new tab via HTTP /json/new (avoids WS conflict with daemon's setAutoAttach)
    await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  }
}

// ─── Result builder ──

function buildResult(project: string, port: number, pid: number | null, browser: string,
  credentialKeys: string[], description: string, proxy: string, chromeArgs: string[],
  daemonInfo: Record<string, string>) {
  const result: Record<string, unknown> = {
    project,
    browser,
    pid: pid || findPidListeningOnPort(port),
    cdp_port: port,
    cdp_url: `http://127.0.0.1:${port}`,
    credential_keys: credentialKeys,
  };
  if (description) result.description = description;
  if (proxy) result.proxy = proxy;
  if (chromeArgs.length) result.chrome_args = chromeArgs;

  // Daemon endpoints
  for (const key of ["api_url", "resources_url", "console_log_url", "download_on_url", "download_off_url"]) {
    if (daemonInfo[key]) result[key] = daemonInfo[key];
  }

  return result;
}

// ─── Main ──

export async function main(args: string[]) {
  let projectName = "default";
  let browserName = "";
  let browserPath = "";
  let openUrl = "";
  let tabIndex: number | undefined;
  let replace = false;

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--project" && i + 1 < args.length) { projectName = args[++i]; }
    else if (args[i] === "--browser" && i + 1 < args.length) { browserName = args[++i]; }
    else if (args[i] === "--browser-path" && i + 1 < args.length) { browserPath = args[++i]; }
    else if (args[i] === "--open-url" && i + 1 < args.length) { openUrl = args[++i]; }
    else if (args[i] === "--tab-index" && i + 1 < args.length) { tabIndex = parseInt(args[++i]); }
    else if (args[i] === "--replace") { replace = true; }
    i++;
  }

  const profiles = loadProfiles();
  const config = (profiles[projectName] || {}) as Record<string, unknown>;

  browserPath = browserPath || (config.browser_path as string) || "";
  browserName = browserName || (config.browser as string) || "chrome";

  const globalKeys = (profiles.browser_global_keys as string[]) || [];
  const projectKeys = (config.browser_project_keys as string[]) || [];
  const credentialKeys = [...new Set([...projectKeys, ...globalKeys])];
  const description = (config.description as string) || "";
  const proxy = (config.proxy as string) || "";
  const chromeArgs = (config.chrome_args as string[]) || [];

  const userDataDir = resolveUserDataDir(projectName);
  cleanLockFiles(userDataDir);

  // Check for existing instance
  const existing = findExistingInstance(userDataDir);
  if (existing) {
    guohub_logger.info(`项目 [${projectName}] 已有运行实例，复用`);
    let daemonInfo: Record<string, string> = {};

    if (!isDaemonRunning(existing.port, projectName)) {
      guohub_logger.info("守护进程未运行，重新启动");
      daemonInfo = await startDaemon(existing.port, existing.pid, projectName);
    }

    const result = buildResult(projectName, existing.port, existing.pid, existing.browser,
      credentialKeys, description, proxy, chromeArgs, daemonInfo);

    if (openUrl) {
      guohub_logger.info(`在已有实例中打开 ${openUrl}`);
      await openUrlInExisting(existing.port, openUrl, tabIndex, replace);
      result.opened_url = openUrl;
    }

    guohub_json_print(result);
    return;
  }

  // Launch new browser
  if (!browserPath) browserPath = findBrowser(browserName);

  const port = await findFreePort();
  const cmd = [
    browserPath,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDataDir}`,
  ];
  if (proxy) cmd.push(`--proxy-server=${proxy}`);
  cmd.push(...chromeArgs);
  if (openUrl) cmd.push(openUrl);

  guohub_logger.info(`项目 [${projectName}] 启动 ${browserName}: ${browserPath}`);
  child_process.spawn(cmd[0], cmd.slice(1), {
    stdio: "ignore",
    detached: process.platform !== "win32",
  }).unref();

  guohub_logger.info("等待 CDP 端口就绪...");
  const info = await waitForCdp(port);
  if (!info) {
    guohub_error_print(`浏览器启动超时，CDP 端口 ${port} 未就绪`);
  }

  const pid = findPidListeningOnPort(port);
  const daemonInfo = await startDaemon(port, pid || 0, projectName);
  const result = buildResult(projectName, port, pid, (info?.Browser as string) || "",
    credentialKeys, description, proxy, chromeArgs, daemonInfo);

  result.prompt = (
    "以下接口均为 GET 访问。"
    + "当用户需要分析业务接口、查看 API 请求和响应时，访问 api_url；"
    + "当用户需要查看页面加载了哪些图片、CSS、JS、字体、视频等静态资源时，访问 resources_url（仅元数据，因体积问题不保存文件内容，如需下载请访问 download_on_url 开启）；"
    + "当用户需要查看 Console 日志或页面报错时，访问 console_log_url；"
    + "当用户需要批量下载图片、视频等资源时，访问 download_on_url 开启下载，之后访问 download_off_url 关闭下载。"
    + "默认只有 API 和 Console 日志，资源不自动下载。"
  );

  guohub_json_print(result);
}
