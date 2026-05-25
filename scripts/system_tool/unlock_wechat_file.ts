import {
  statSync,
  chmodSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  guohub_logger,
  guohub_json_print,
  guohub_error_print,
  guohub_text_print,
} from "#common_js/log.js";

interface UnlockResult {
  path: string;
  fixedReadonly: boolean;
  removedMark: boolean;
}

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";

function unlockFile(filePath: string): UnlockResult {
  const result: UnlockResult = {
    path: filePath,
    fixedReadonly: false,
    removedMark: false,
  };

  // 1. 解除只读 / 修复权限
  try {
    if (isWin) {
      execSync(`attrib -R "${filePath}"`, { stdio: "ignore" });
    } else {
      chmodSync(filePath, 0o644);
    }
    result.fixedReadonly = true;
  } catch {
    // 权限修改失败不阻塞后续操作
  }

  // 2. 移除微信/浏览器带来的安全标记
  if (isWin) {
    try {
      unlinkSync(`${filePath}:Zone.Identifier`);
      result.removedMark = true;
    } catch {
      // Zone.Identifier 不存在则忽略
    }
  } else if (isMac) {
    try {
      execSync(`xattr -d com.apple.quarantine "${filePath}"`, { stdio: "ignore" });
      result.removedMark = true;
    } catch {
      // com.apple.quarantine 不存在则忽略
    }
  }

  return result;
}

function unlockDir(dir: string, results: UnlockResult[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      unlockDir(fullPath, results);
    } else if (entry.isFile()) {
      results.push(unlockFile(fullPath));
    }
  }
}

export async function main(args: string[]) {
  let target = "";
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
      case "-f": {
        target = resolve(args[++i]);
        break;
      }
      case "--dir":
      case "-d": {
        target = resolve(args[++i]);
        break;
      }
      case "--json": {
        jsonOutput = true;
        break;
      }
    }
  }

  // 兼容直接传路径
  if (!target && args.length > 0 && !args[0].startsWith("-")) {
    target = resolve(args[0]);
  }

  if (!target) {
    guohub_error_print(
      `用法: unlock-wechat-file <路径> 或 --file <文件> 或 --dir <目录> [--json]\n\n` +
        `解除微信下载文件的只读限制和安全标记。\n` +
        `支持 Windows (只读属性 + Zone.Identifier) 和 macOS (权限 + com.apple.quarantine)。`,
    );
  }

  if (!existsSync(target)) {
    guohub_error_print(`路径不存在: ${target}`);
  }

  const stats = statSync(target);
  const results: UnlockResult[] = [];

  guohub_logger.info(`正在处理: ${target}`);

  if (stats.isFile()) {
    results.push(unlockFile(target));
  } else if (stats.isDirectory()) {
    unlockDir(target, results);
  }

  const fixedCount = results.filter((r) => r.fixedReadonly).length;
  const markCount = results.filter((r) => r.removedMark).length;

  if (jsonOutput) {
    guohub_json_print({
      processed: results.length,
      fixed_readonly: fixedCount,
      removed_marks: markCount,
      results,
    });
  }

  if (results.length === 1) {
    const r = results[0];
    const parts: string[] = [];
    if (r.fixedReadonly) parts.push("已解除只读");
    if (r.removedMark) parts.push("已移除安全标记");
    guohub_text_print(
      parts.length > 0 ? `✅ ${parts.join("，")}` : `ℹ️ 无需处理`,
    );
  } else {
    guohub_text_print(
      `✅ 处理完成：共 ${results.length} 个文件\n` +
        `   解除只读: ${fixedCount}\n` +
        `   移除安全标记: ${markCount}`,
    );
  }
}
