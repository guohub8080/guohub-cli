import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { guohub_logger, guohub_text_print, guohub_success_print, guohub_error_print } from "#common_js/log.js";

const OPEN_DQ = "“";
const CLOSE_DQ = "”";
const OPEN_SQ = "‘";
const CLOSE_SQ = "’";

function fixQuotes(text: string): string {
  text = text.replace(/[“”„‟]/g, '"');
  text = text.replace(/[‘’‚‛]/g, "'");
  const out: string[] = [];
  let dqOpen = false, sqOpen = false;
  for (const ch of text) {
    if (ch === '"') {
      out.push(dqOpen ? CLOSE_DQ : OPEN_DQ);
      dqOpen = !dqOpen;
    } else if (ch === "'") {
      out.push(sqOpen ? CLOSE_SQ : OPEN_SQ);
      sqOpen = !sqOpen;
    } else {
      out.push(ch);
    }
  }
  return out.join("");
}

function checkQuotes(text: string): string[] {
  const issues: string[] = [];
  let dqOpen = false, sqOpen = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      dqOpen = !dqOpen;
    } else if (ch === "'") {
      sqOpen = !sqOpen;
    } else if (ch === OPEN_DQ || ch === CLOSE_DQ) {
      if (ch === OPEN_DQ) {
        if (dqOpen) issues.push(`第 ${i + 1} 字符：双引号未闭合就开了新的`);
        dqOpen = true;
      } else {
        if (!dqOpen) issues.push(`第 ${i + 1} 字符：双引号多了一个右引号`);
        dqOpen = false;
      }
    } else if (ch === OPEN_SQ || ch === CLOSE_SQ) {
      if (ch === OPEN_SQ) {
        if (sqOpen) issues.push(`第 ${i + 1} 字符：单引号未闭合就开了新的`);
        sqOpen = true;
      } else {
        if (!sqOpen) issues.push(`第 ${i + 1} 字符：单引号多了一个右引号`);
        sqOpen = false;
      }
    }
  }
  if (dqOpen) issues.push("双引号未闭合");
  if (sqOpen) issues.push("单引号未闭合");
  return issues;
}

function getClipboard(): string {
  if (process.platform === "darwin") return execSync("pbpaste", { encoding: "utf-8" });
  return execSync("powershell -command Get-Clipboard", { encoding: "utf-8" });
}

function setClipboard(text: string) {
  if (process.platform === "darwin") execSync("pbcopy", { input: text });
  else execSync("clip", { input: text });
}

export function main(args: string[]) {
  let fromFile: string | null = null;
  let fromClipboard = false;
  let toClipboard = false;
  let checkOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-f" || args[i] === "--file") fromFile = args[++i];
    else if (args[i] === "--from-clipboard") fromClipboard = true;
    else if (args[i] === "--to-clipboard") toClipboard = true;
    else if (args[i] === "--check") checkOnly = true;
  }

  let text: string;
  if (fromFile) {
    const p = resolve(fromFile);
    if (!existsSync(p)) guohub_error_print(`文件不存在：${p}`);
    text = readFileSync(p, "utf-8");
  } else if (fromClipboard) {
    text = getClipboard();
  } else if (!process.stdin.isTTY) {
    text = readFileSync(0, "utf-8");
  } else {
    guohub_error_print("请指定输入来源：-f <文件> / --from-clipboard / 管道输入");
  }

  if (checkOnly) {
    const issues = checkQuotes(text!);
    if (issues.length) {
      for (const issue of issues) guohub_logger.info(issue);
      guohub_error_print("引号检查未通过");
    }
    guohub_logger.info("引号检查通过");
    guohub_success_print();
  }

  const result = fixQuotes(text!);
  if (toClipboard) {
    setClipboard(result);
    guohub_logger.info("已复制到剪贴板");
  }
  guohub_text_print(result);
}
