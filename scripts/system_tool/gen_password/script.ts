import { randomInt } from "node:crypto";
import { guohub_logger, guohub_text_print } from "#common_js/log.js";
import { writeClipboard } from "#common_js/clipboard.js";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SAFE_SYMBOLS = "!@#$%&-_+=";
const ALL_SYMBOLS = "!@#$%^&*()-_=+[]{}|;:',.<>?/`~";

function choice(str: string): string {
  return str[randomInt(str.length)];
}

function genPassword(
  length: number,
  upper: boolean,
  lower: boolean,
  digits: boolean,
  symbols: boolean,
  symbolsSet: string,
): string {
  let chars = "";
  const required: string[] = [];
  if (upper) { chars += UPPER; required.push(choice(UPPER)); }
  if (lower) { chars += LOWER; required.push(choice(LOWER)); }
  if (digits) { chars += DIGITS; required.push(choice(DIGITS)); }
  if (symbols) { chars += symbolsSet; required.push(choice(symbolsSet)); }
  if (!chars) return "";

  const rest = Array.from({ length: length - required.length }, () => choice(chars));
  const result = [...required, ...rest];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join("");
}

export function main(args: string[]) {
  let length = 18;
  let noUpper = false, noLower = false, noDigits = false, noSymbols = false;
  let toClipboard = false, allSymbols = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--length": length = parseInt(args[++i]); break;
      case "--no-upper": noUpper = true; break;
      case "--no-lower": noLower = true; break;
      case "--no-digits": noDigits = true; break;
      case "--no-symbols": noSymbols = true; break;
      case "--to-clipboard": toClipboard = true; break;
      case "--all-symbols": allSymbols = true; break;
    }
  }

  const symbols = allSymbols ? ALL_SYMBOLS : SAFE_SYMBOLS;
  const password = genPassword(Math.max(length, 4), !noUpper, !noLower, !noDigits, !noSymbols, symbols);

  if (toClipboard) {
    writeClipboard(password);
    guohub_logger.info("已复制密码到剪贴板");
  }

  guohub_text_print(password);
}
