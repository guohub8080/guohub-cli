import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

function queryRegistry(key: string, value: string): string | null {
  if (process.platform !== "win32") return null;
  try {
    const result = child_process.execSync(
      `reg query "${key}" /v "${value}"`,
      { encoding: "utf-8", timeout: 3000 },
    );
    const match = result.match(/REG_SZ\s+(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

export function findBrowser(browserName: string): string {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const PATHS: Record<string, Record<string, string[]>> = {
    chrome: {
      darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      win32: [
        `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
        `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
        `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
    },
    chromium: {
      darwin: ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
      win32: [
        `${localAppData}\\Chromium\\Application\\chrome.exe`,
        `${programFiles}\\Chromium\\Application\\chrome.exe`,
      ],
    },
    edge: {
      darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      win32: [
        `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ],
    },
    brave: {
      darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
      win32: [
        `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${programFilesX86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        `${localAppData}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      ],
    },
  };

  // 1. Standard installation paths
  for (const p of (PATHS[browserName]?.[process.platform] || [])) {
    if (fs.existsSync(p)) return p;
  }

  // 2. Windows: registry fallback
  if (process.platform === "win32") {
    const regKeys: Record<string, [string, string][]> = {
      chrome: [
        ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe", "Path"],
        ["HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome", "InstallLocation"],
      ],
      edge: [
        ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe", "Path"],
        ["HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Microsoft Edge", "InstallLocation"],
      ],
      brave: [
        ["HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\brave.exe", "Path"],
        ["HKCU\\SOFTWARE\\BraveSoftware\\Brave-Browser", "InstallPath"],
      ],
    };
    const exeNames: Record<string, string> = { chrome: "chrome.exe", edge: "msedge.exe", brave: "brave.exe" };
    const exe = exeNames[browserName] || "";
    for (const [key, value] of (regKeys[browserName] || [])) {
      const regPath = queryRegistry(key, value);
      if (regPath) {
        const fullPath = path.join(regPath, exe);
        if (fs.existsSync(fullPath)) return fullPath;
      }
    }
  }

  // 3. macOS: Homebrew cask
  if (process.platform === "darwin") {
    const homebrewPaths: Record<string, { dir: string; suffix: string }> = {
      chrome: { dir: "/opt/homebrew/Caskroom/google-chrome", suffix: "Google Chrome.app/Contents/MacOS/Google Chrome" },
      chromium: { dir: "/opt/homebrew/Caskroom/chromium", suffix: "Chromium.app/Contents/MacOS/Chromium" },
      edge: { dir: "/opt/homebrew/Caskroom/microsoft-edge", suffix: "Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      brave: { dir: "/opt/homebrew/Caskroom/brave-browser", suffix: "Brave Browser.app/Contents/MacOS/Brave Browser" },
    };
    const hb = homebrewPaths[browserName];
    if (hb && fs.existsSync(hb.dir)) {
      try {
        for (const v of fs.readdirSync(hb.dir).sort().reverse()) {
          const candidate = path.join(hb.dir, v, hb.suffix);
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch { /* empty */ }
    }
  }

  // 4. which / where fallback
  const exeNames: Record<string, string[]> = {
    chrome: ["google-chrome", "google-chrome-stable", "chrome"],
    chromium: ["chromium", "chromium-browser"],
    edge: ["microsoft-edge", "microsoft-edge-stable", "msedge"],
    brave: ["brave-browser", "brave"],
  };
  const cmd = process.platform === "win32" ? "where" : "which";
  for (const name of (exeNames[browserName] || [])) {
    try {
      const result = child_process.execSync(`${cmd} ${name} 2>/dev/null`, {
        encoding: "utf-8", timeout: 3000,
      });
      const found = result.trim().split("\n")[0].trim();
      if (found && fs.existsSync(found)) return found;
    } catch { /* empty */ }
  }

  return "";
}
