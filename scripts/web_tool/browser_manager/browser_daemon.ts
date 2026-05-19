import * as http from "node:http";
import * as net from "node:net";
import WebSocket from "ws";

const IS_RESOURCE_TYPE = new Set([
  "image", "font", "media", "stylesheet", "script",
  "Image", "Font", "Media", "Stylesheet", "Script",
]);

function now(): string {
  const d = new Date();
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  const iso = d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  return `${iso}.${ms}`;
}

function trimList(list: unknown[], limit: number) {
  while (list.length > limit) list.shift();
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    process.stderr.write("用法: browser_daemon.ts <cdp_port> <chrome_pid> <project_name>\n");
    process.exit(1);
  }

  const cdpPort = parseInt(args[0]);
  const chromePid = parseInt(args[1]);
  const projectName = args[2];

  const apiLogs: Record<string, unknown>[] = [];
  const resourceLogs: Record<string, unknown>[] = [];
  const consoleLogs: Record<string, unknown>[] = [];

  const config = {
    download_resources: false,
    body_limit: 1024 * 1024,
    api_log_limit: 10000,
    resource_log_limit: 10000,
    console_log_limit: 10000,
  };

  // ── Find free port ──
  const httpPort = await new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

  // ── HTTP Server ──
  const server = http.createServer((req, res) => {
    const clientIp = req.socket.remoteAddress || "";
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(clientIp)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end('{"error":"forbidden"}');
      return;
    }

    const url = new URL(req.url || "/", `http://127.0.0.1:${httpPort}`);
    const path = url.pathname;
    const limit = parseInt(url.searchParams.get("limit") || "10000");

    const jsonRes = (data: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (path === "/api") jsonRes(apiLogs.slice(-limit));
    else if (path === "/resources") jsonRes(resourceLogs.slice(-limit));
    else if (path === "/console_log") jsonRes(consoleLogs.slice(-limit));
    else if (path === "/download-on") { config.download_resources = true; jsonRes({ download_resources: true }); }
    else if (path === "/download-off") { config.download_resources = false; jsonRes({ download_resources: false }); }
    else if (path === "/") {
      jsonRes({
        endpoints: {
          "/api": `API 请求日志（最近 ${apiLogs.length} 条）`,
          "/resources": `资源请求元数据（最近 ${resourceLogs.length} 条）`,
          "/console_log": `Console 日志（最近 ${consoleLogs.length} 条）`,
          "/download-on": "开启资源下载（GET）",
          "/download-off": "关闭资源下载（GET）",
        },
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(httpPort, "127.0.0.1");

  // ── Output daemon info ──
  const daemonInfo = {
    api_url: `http://127.0.0.1:${httpPort}/api`,
    resources_url: `http://127.0.0.1:${httpPort}/resources`,
    console_log_url: `http://127.0.0.1:${httpPort}/console_log`,
    download_on_url: `http://127.0.0.1:${httpPort}/download-on`,
    download_off_url: `http://127.0.0.1:${httpPort}/download-off`,
  };
  console.log(JSON.stringify(daemonInfo));

  // ── CDP Monitor via raw WebSocket ──
  const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  const versionData = await resp.json() as { webSocketDebuggerUrl: string };
  const browserWsUrl = versionData.webSocketDebuggerUrl;

  const ws = new WebSocket(browserWsUrl, { maxPayload: 50 * 1024 * 1024 });
  let msgId = 0;
  const frameUrls: Record<string, string> = {};

  function nextId(): number { return ++msgId; }

  function sendCDP(method: string, params?: Record<string, unknown>, sessionId?: string) {
    const msg: Record<string, unknown> = { id: nextId(), method };
    if (params) msg.params = params;
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
  }

  function processEvent(method: string, params: Record<string, unknown>) {
    if (!method) return;

    if (method === "Network.requestWillBeSent") {
      const req = (params.request || {}) as Record<string, unknown>;
      const rt = (params.type as string) || "";
      const frameId = (params.frameId as string) || "";
      const pageUrl = frameUrls[frameId] || "";

      if (params.redirectResponse) {
        const redir = params.redirectResponse as Record<string, unknown>;
        const entry: Record<string, unknown> = {
          time: now(),
          page_url: pageUrl,
          url: params.url || "",
          status: redir.status,
          resource_type: rt,
          response_headers: redir.headers,
        };
        const isRes = IS_RESOURCE_TYPE.has(rt);
        const list = isRes ? resourceLogs : apiLogs;
        const limit = isRes ? config.resource_log_limit : config.api_log_limit;
        list.push(entry);
        trimList(list, limit);
      }

      const entry: Record<string, unknown> = {
        time: now(),
        page_url: pageUrl,
        url: req.url,
        method: req.method,
        resource_type: rt,
        headers: req.headers,
      };
      if (req.postData) entry.request_body = req.postData;

      const isRes = IS_RESOURCE_TYPE.has(rt);
      const list = isRes ? resourceLogs : apiLogs;
      const limit = isRes ? config.resource_log_limit : config.api_log_limit;
      list.push(entry);
      trimList(list, limit);
    }

    else if (method === "Network.responseReceived") {
      const respData = (params.response || {}) as Record<string, unknown>;
      const rt = (params.type as string) || "";
      const frameId = (params.frameId as string) || "";
      const pageUrl = frameUrls[frameId] || "";
      const headers = (respData.headers || {}) as Record<string, string>;

      const entry: Record<string, unknown> = {
        time: now(),
        page_url: pageUrl,
        url: respData.url,
        status: respData.status,
        resource_type: rt,
        content_type: headers["content-type"] || "",
        content_length: headers["content-length"],
        response_headers: headers,
      };

      const isRes = IS_RESOURCE_TYPE.has(rt);
      const list = isRes ? resourceLogs : apiLogs;
      const limit = isRes ? config.resource_log_limit : config.api_log_limit;
      list.push(entry);
      trimList(list, limit);
    }

    else if (method === "Runtime.consoleAPICalled") {
      const argsList = (params.args || []) as Array<Record<string, unknown>>;
      const textParts = argsList.map((arg) =>
        arg.value !== undefined ? String(arg.value) : (arg.description as string || "")
      );
      consoleLogs.push({
        time: now(),
        level: params.type || "log",
        text: textParts.join(" "),
      });
      trimList(consoleLogs, config.console_log_limit);
    }

    else if (method === "Runtime.exceptionThrown") {
      const excDetails = (params.exceptionDetails || {}) as Record<string, unknown>;
      const excObj = (excDetails.exception || {}) as Record<string, unknown>;
      const text = (excDetails.text || "") as string;
      consoleLogs.push({
        time: now(),
        level: "pageerror",
        text: (excObj.description as string) || text,
      });
      trimList(consoleLogs, config.console_log_limit);
    }

    else if (method === "Page.frameNavigated") {
      const frame = (params.frame || {}) as Record<string, unknown>;
      const fid = frame.id as string;
      const furl = frame.url as string;
      if (fid && furl) frameUrls[fid] = furl;
    }
  }

  // Wait for WebSocket to open
  await new Promise<void>((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  // setAutoAttach to catch all pages
  sendCDP("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });

  // Main message loop
  ws.on("message", (raw: Buffer) => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    const method = data.method as string;
    const params = (data.params || {}) as Record<string, unknown>;

    if (method === "Target.attachedToTarget") {
      const newSid = params.sessionId as string;
      const targetInfo = (params.targetInfo || {}) as Record<string, unknown>;
      const targetType = targetInfo.type as string;

      if (newSid && targetType === "page") {
        for (const domain of ["Network", "Runtime", "Log", "Page"]) {
          sendCDP(`${domain}.enable`, undefined, newSid);
        }
        sendCDP("Runtime.runIfWaitingForDebugger", undefined, newSid);
      }
    } else if (method) {
      processEvent(method, params);
    }
  });

  // Keep alive until browser dies
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (!isAlive(chromePid)) {
        clearInterval(check);
        ws.close();
        resolve();
      }
    }, 2000);
  });

  server.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`daemon error: ${err}\n`);
  process.exit(1);
});
