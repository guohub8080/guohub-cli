import { execSync, execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.GUOHUB_ROOT!;

function log(msg: string) {
  console.log(`[guohub-cli] ${msg}`);
}

function checkUv(): boolean {
  try {
    execSync("uv --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function checkEnv() {
  log("=== guohub-cli 环境检查 ===");

  const venv = resolve(root, ".venv");
  if (existsSync(venv)) {
    log(`✓ 虚拟环境已存在：${venv}`);
  } else {
    log("✗ 虚拟环境不存在，正在创建...");
    execSync("uv venv", { cwd: root, stdio: "inherit" });
    log("✓ 虚拟环境创建完成");
  }

  const config = resolve(root, "config.toml");
  if (existsSync(config)) {
    log(`✓ 配置文件已存在：${config}`);
  } else {
    log("  配置文件不存在（首次运行会自动生成）");
  }

  const devTemp = resolve(root, "dev_temp");
  if (!existsSync(devTemp)) {
    mkdirSync(devTemp, { recursive: true });
    log(`  已创建临时目录：${devTemp}`);
  } else {
    log(`✓ 临时目录已存在：${devTemp}`);
  }
}

function checkGlobalLink() {
  try {
    const result = execSync("where guohub-cli", { encoding: "utf-8" });
    if (result.trim()) {
      log(`✓ guohub-cli 已注册全局命令：${result.trim()}`);
      return;
    }
  } catch {
    // not found
  }

  log("✗ guohub-cli 未注册为全局命令，正在执行 npm link...");
  try {
    execSync("npm link", { cwd: root, stdio: "inherit" });
    log("✓ npm link 完成");
  } catch (e) {
    log(`  npm link 失败：${e}，请手动执行 npm link`);
  }
}

function findPandoc(): string | null {
  try {
    const pandoc = execSync("where pandoc", { encoding: "utf-8" }).trim().split("\r\n")[0];
    if (pandoc) return pandoc;
  } catch {
    // not found
  }

  const candidates = [
    resolve(process.env.LOCALAPPDATA || "", "Pandoc/pandoc.exe"),
    "C:/Program Files/Pandoc/pandoc.exe",
    "C:/Program Files (x86)/Pandoc/pandoc.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function checkPandoc() {
  const pandoc = findPandoc();
  if (pandoc) {
    log(`✓ pandoc 已安装：${pandoc}`);
    return;
  }
  log("✗ pandoc 未安装（用于 .doc 格式转换）");
  log("  安装命令：winget install JohnMacFarlane.Pandoc");
}

function ensureDependencies() {
  const deps = ["keyring", "requests", "pyperclip", "pillow", "python-docx"];
  log(`正在安装依赖（${deps.join(", ")}）...`);
  execSync(`uv add ${deps.join(" ")}`, { cwd: root, stdio: "inherit" });
  log("依赖安装完成");
}

function scanPluginDependencies() {
  const pluginsDir = resolve(root, "plugins");
  if (!existsSync(pluginsDir)) return;

  const deps: string[] = [];
  for (const dir of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const metaPath = join(pluginsDir, dir.name, "plugin.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    deps.push(...(meta.py_dependencies || []));
  }

  if (!deps.length) return;

  log(`正在安装插件依赖（${deps.join(", ")}）...`);
  execSync(`uv add ${deps.join(" ")}`, { cwd: root, stdio: "inherit" });
  log("插件依赖安装完成");
}

function validatePlugins() {
  const pluginsDir = resolve(root, "plugins");
  if (!existsSync(pluginsDir)) return;

  log("=== 插件检查 ===");
  let hasError = false;

  for (const dir of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const metaPath = join(pluginsDir, dir.name, "plugin.json");
    if (!existsSync(metaPath)) continue;

    let meta: any;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    } catch (e) {
      log(`✗ [${dir.name}] plugin.json 解析失败：${e}`);
      hasError = true;
      continue;
    }

    if (!meta.name) {
      log(`✗ [${dir.name}] 缺少 name 字段`);
      hasError = true;
      continue;
    }

    const commands = meta.commands || [];
    if (!Array.isArray(commands)) {
      log(`✗ [${dir.name}] commands 必须是数组`);
      hasError = true;
      continue;
    }

    for (const cmd of commands) {
      const required = ["name", "desc", "type", "entry"];
      const missing = required.filter((f) => !(f in cmd));
      if (missing.length) {
        log(`✗ [${dir.name}] 命令缺少字段：${missing.join(", ")}`);
        hasError = true;
        continue;
      }
      if (cmd.type !== "ts" && cmd.type !== "py") {
        log(`✗ [${dir.name}] 命令 ${cmd.name} 的 type 必须是 ts 或 py`);
        hasError = true;
        continue;
      }
      if (!existsSync(join(pluginsDir, dir.name, cmd.entry))) {
        log(`✗ [${dir.name}] 入口文件不存在：${cmd.entry}`);
        hasError = true;
        continue;
      }
    }

    log(`✓ [${dir.name}] ${commands.length} 个命令`);
  }

  if (!hasError) log("所有插件验证通过");
}

export function main(_args: string[]) {
  if (!checkUv()) {
    console.error(
      "[guohub-cli] Python 环境未就绪\n\n" +
      "本项目部分功能需要 Python 环境，未找到 uv（Python 包管理器）\n\n" +
      "请按以下步骤初始化：\n" +
      "  1. 安装 uv:    curl -LsSf https://astral.sh/uv/install.sh | sh\n" +
      "  2. 重启终端（或执行 source ~/.zshrc）\n" +
      "  3. 初始化环境:  pnpm dev doctor\n\n" +
      "Windows 用户请访问: https://docs.astral.sh/uv/getting-started/installation/\n"
    );
    process.exit(1);
  }

  checkEnv();
  checkGlobalLink();
  checkPandoc();
  ensureDependencies();
  scanPluginDependencies();
  validatePlugins();
  log('{"status": "ready"}');
}
