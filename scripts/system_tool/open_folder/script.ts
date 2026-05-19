import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { guohub_logger, guohub_success_print, guohub_error_print } from "#common_js/log.js";

export function main(args: string[]) {
  const input = args[0];
  if (!input) guohub_error_print("请指定路径");

  let p = resolve(input);
  if (!existsSync(p)) guohub_error_print(`路径不存在：${p}`);
  if (!statSync(p).isDirectory()) p = dirname(p);

  if (process.platform === "darwin") {
    execSync(`open "${p}"`);
  } else if (process.platform === "win32") {
    execSync(`explorer "${p}"`);
  } else {
    execSync(`xdg-open "${p}"`);
  }

  guohub_logger.info(`已打开：${p}`);
  guohub_success_print();
}
