import { execFileSync, execSync } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

function checkUv(): boolean {
  try {
    execSync("uv --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function checkVenv(root: string): boolean {
  return existsSync(resolve(root, ".venv"));
}

export function runPython(scriptPath: string, args: string[] = []) {
  const root = process.env.GUOHUB_ROOT!;
  const sep = process.platform === "win32" ? ";" : ":";
  const pythonpath = `${root}${sep}${join(root, "plugins")}`;

  if (!checkUv()) {
    process.stderr.write(
      "[guohub-cli] Python 环境未就绪\n\n" +
      "本项目部分功能需要 Python 环境，检测到以下问题：\n" +
      "  ✗ 未找到 uv（Python 包管理器）\n\n" +
      "请按以下步骤初始化：\n" +
      "  1. 安装 uv:    curl -LsSf https://astral.sh/uv/install.sh | sh\n" +
      "  2. 重启终端（或执行 source ~/.zshrc）\n" +
      "  3. 初始化环境:  pnpm dev doctor\n\n" +
      "Windows 用户请访问: https://docs.astral.sh/uv/getting-started/installation/\n"
    );
    process.exit(1);
  }

  if (!checkVenv(root)) {
    process.stderr.write(
      "[guohub-cli] Python 虚拟环境未初始化\n\n" +
      "检测到 uv 已安装，但 .venv 目录不存在。\n\n" +
      "请执行初始化：\n" +
      "  pnpm dev doctor\n\n" +
      "该命令会自动：\n" +
      "  - 创建 Python 虚拟环境\n" +
      "  - 安装所需依赖（keyring, requests, pillow 等）\n" +
      "  - 配置系统凭据\n"
    );
    process.exit(1);
  }

  try {
    execFileSync("uv", ["run", "python", resolve(root, scriptPath), ...args], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: pythonpath },
      stdio: "inherit",
    });
  } catch (e: any) {
    if (e.code === "ENOENT") {
      process.stderr.write("错误：找不到 uv，请先安装 uv（https://docs.astral.sh/uv/）\n");
      process.exit(1);
    }
    if (e.status != null) process.exit(e.status);
    throw e;
  }
}
