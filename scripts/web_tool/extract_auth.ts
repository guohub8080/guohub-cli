import { chromium } from "playwright";
import { guohub_logger, guohub_json_print, guohub_error_print, guohub_text_print } from "#common_js/log.js";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

function parseArgs(args: string[]) {
  let cdpPort: number | null = null;
  let domain = "";
  let project = "";
  let save = false;
  let format: "json" | "header" | "name-value" | "curl" = "json";
  let storage: "cookie" | "localStorage" | "sessionStorage" | "all" = "all";
  let authType: "auto" | "bearer" | "cookie" | "apikey" | "basic" | "custom" = "auto";
  let authHeader = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--cdp-port":
        cdpPort = parseInt(args[++i]);
        break;
      case "--domain":
        domain = args[++i];
        break;
      case "--project":
        project = args[++i];
        break;
      case "--save":
        save = true;
        break;
      case "--format":
        format = args[++i] as "json" | "header" | "name-value" | "curl";
        break;
      case "--storage":
        storage = args[++i] as "cookie" | "localStorage" | "sessionStorage" | "all";
        break;
      case "--auth-type":
        authType = args[++i] as "auto" | "bearer" | "cookie" | "apikey" | "basic" | "custom";
        break;
      case "--auth-header":
        authHeader = args[++i];
        break;
    }
  }

  return { cdpPort, domain, project, save, format, storage, authType, authHeader };
}

// ─── 值特征检测 ──

function isJwt(value: string): boolean {
  if (!value.startsWith("eyJ")) return false;
  const parts = value.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function extractJwtFromObject(val: unknown): string | null {
  if (typeof val === "string" && isJwt(val)) return val;
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    // 常见嵌套结构: { data: "eyJ...", token: "eyJ...", accessToken: "eyJ..." }
    for (const k of ["data", "token", "accessToken", "refreshToken", "idToken"]) {
      const v = obj[k];
      if (typeof v === "string" && isJwt(v)) return v;
    }
  }
  return null;
}

// ─── 启发式评分（auth-type=auto 时用） ──

function scoreAuth(key: string, value: string): number {
  let score = 0;
  const lowerKey = key.toLowerCase();

  const strong = ["token", "auth", "secret", "credential", "bearer", "jwt"];
  const weak = ["session", "login", "access", "refresh", "api_key", "apikey"];

  if (strong.some((k) => lowerKey.includes(k))) score += 20;
  if (weak.some((k) => lowerKey.includes(k))) score += 10;
  if (isJwt(value)) score += 25;
  if (/^[A-Za-z0-9_-]{20,64}$/.test(value)) score += 15;
  if (value.length > 50 && value.length < 500) score += 5;

  // 排除噪音
  if (lowerKey.includes("iconify")) score -= 30;
  if (lowerKey.includes("count")) score -= 20;
  if (value.length < 10) score -= 15;
  if (value.length > 2000) score -= 10;

  return score;
}

// ─── 根据 auth-type 和 auth-header 精准定位 ──

function findAuthByType(
  items: Record<string, string>,
  authType: string,
  authHeader: string,
): Record<string, unknown> {
  const auth: Record<string, unknown> = {};

  // 如果 LLM 传了 authHeader，先从中提取 token 值，然后去 Storage 里找匹配的 key
  let targetValue = "";
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      targetValue = authHeader.slice(7);
    } else if (authHeader.includes("=")) {
      // Cookie 格式: key=value
      targetValue = authHeader.split("=")[1]?.split(";")[0] || "";
    } else {
      targetValue = authHeader;
    }
  }

  for (const [key, value] of Object.entries(items)) {
    let matched = false;

    // 1. 如果知道目标值，直接匹配
    if (targetValue && value.includes(targetValue)) {
      matched = true;
    }

    // 2. 按 auth-type 匹配
    if (!matched) {
      switch (authType) {
        case "bearer":
          if (isJwt(value) || extractJwtFromObject(JSON.parse(value) as unknown) !== null) {
            matched = true;
          }
          break;
        case "apikey":
          if (/^[A-Za-z0-9_-]{20,64}$/.test(value)) matched = true;
          break;
        case "cookie":
          // Cookie 认证不需要从 Storage 提取，已在 Cookie 部分处理
          break;
        case "auto":
          if (scoreAuth(key, value) >= 15) matched = true;
          break;
      }
    }

    if (matched) {
      try {
        auth[key] = JSON.parse(value);
      } catch {
        auth[key] = value.length > 500 ? value.slice(0, 500) + "..." : value;
      }
    }
  }

  return auth;
}

export async function main(args: string[]) {
  const { cdpPort, domain, project, save, format, storage, authType, authHeader } = parseArgs(args);

  if (!domain) {
    guohub_error_print("缺少 --domain 参数，例如: --domain app.yourmusic.fun");
  }

  if (!cdpPort) {
    guohub_error_print("缺少 --cdp-port 参数。请先用 find-ex-browser 等命令获取 CDP 端口，再传入 --cdp-port");
  }

  const cdpUrl = `http://127.0.0.1:${cdpPort}`;
  guohub_logger.info(`连接 CDP: ${cdpUrl}`);
  guohub_logger.info(`提取域名: ${domain}`);
  guohub_logger.info(`存储类型: ${storage}`);
  if (authType !== "auto") guohub_logger.info(`认证类型: ${authType}`);
  if (authHeader) guohub_logger.info(`LLM 提供请求头线索: ${authHeader.slice(0, 50)}...`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    guohub_error_print(`无法连接到 CDP (${cdpUrl}): ${err instanceof Error ? err.message : String(err)}`);
  }

  const context = browser.contexts()[0];
  if (!context) {
    guohub_error_print("浏览器没有可用的 context");
  }

  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  const result: Record<string, unknown> = { domain, cdp_port: cdpPort };

  // ─── Cookie ──
  if (storage === "cookie" || storage === "all") {
    const cookies = await context.cookies(url);
    const now = Date.now() / 1000;
    const validCookies = cookies.filter((c) => !c.expires || c.expires === -1 || c.expires > now);
    guohub_logger.info(`Cookie: ${validCookies.length} 个有效`);
    result.cookies = validCookies.map((c) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires === -1 ? "session" : new Date(c.expires * 1000).toISOString(),
      httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite,
    }));
  }

  const page = context.pages()[0];
  if (!page) {
    guohub_error_print("浏览器没有可用的页面");
  }

  // ─── LocalStorage ──
  if (storage === "localStorage" || storage === "all") {
    const raw = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) items[key] = localStorage.getItem(key) || "";
      }
      return items;
    });

    const auth = findAuthByType(raw, authType, authHeader);
    const other: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in auth)) other[k] = v.length > 200 ? v.slice(0, 200) + "..." : v;
    }

    guohub_logger.info(`LocalStorage: ${Object.keys(raw).length} 项，认证相关 ${Object.keys(auth).length} 项`);
    result.localStorage = { auth, other };
  }

  // ─── SessionStorage ──
  if (storage === "sessionStorage" || storage === "all") {
    const raw = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) items[key] = sessionStorage.getItem(key) || "";
      }
      return items;
    });

    const auth = findAuthByType(raw, authType, authHeader);
    const other: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!(k in auth)) other[k] = v.length > 200 ? v.slice(0, 200) + "..." : v;
    }

    guohub_logger.info(`SessionStorage: ${Object.keys(raw).length} 项，认证相关 ${Object.keys(auth).length} 项`);
    result.sessionStorage = { auth, other };
  }

  // ─── 生成 API 请求头 ──
  const headers: Record<string, string> = {};

  const cookieHeader = ((result.cookies as Array<{ name: string; value: string }>) || [])
    .map((c) => `${c.name}=${c.value}`).join("; ");
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  // 从 auth 中提取 token 生成 Authorization
  const allAuth = {
    ...(result.localStorage as Record<string, Record<string, unknown>>)?.auth,
    ...(result.sessionStorage as Record<string, Record<string, unknown>>)?.auth,
  };

  for (const [, val] of Object.entries(allAuth)) {
    const jwt = extractJwtFromObject(val);
    if (jwt) {
      headers["Authorization"] = `Bearer ${jwt}`;
      break;
    }
    if (typeof val === "string" && isJwt(val)) {
      headers["Authorization"] = `Bearer ${val}`;
      break;
    }
  }

  result.suggestedHeaders = headers;

  if (save) {
    if (!project) {
      guohub_error_print("--save 需要指定 --project 参数");
    }
    const root = process.env.GUOHUB_ROOT;
    if (!root) {
      guohub_error_print("GUOHUB_ROOT 未设置");
    }
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const fileName = `auth_${domain.replace(/[^a-zA-Z0-9]/g, "_")}_${ts}.json`;
    const dir = join(root, "scripts/web_tool/browser_manager/local_data", project, "auth");
    const filePath = join(dir, fileName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
    guohub_logger.info(`已保存: ${filePath}`);
  }

  // ─── 输出 ──
  if (format === "header" && result.cookies) {
    const header = (result.cookies as Array<{ name: string; value: string }>)
      .map((c) => `${c.name}=${c.value}`).join("; ");
    guohub_text_print(header);
  } else if (format === "name-value" && result.cookies) {
    const pairs = (result.cookies as Array<{ name: string; value: string }>)
      .map((c) => `${c.name}=${c.value}`).join("\n");
    guohub_text_print(pairs);
  } else if (format === "curl") {
    const h = Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}'`).join(" \\\n");
    guohub_text_print(`curl ${h} \\\n  '${url}'`);
  } else {
    guohub_json_print(result);
  }
  // 不调用 browser.close()，避免关闭底层浏览器进程
}
