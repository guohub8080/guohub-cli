import { guohub_text_print } from "#common_js/log.js";
import { writeClipboard } from "#common_js/clipboard.js";

export async function main(args: string[]) {
  const count = args.includes("--count") ? parseInt(args[args.indexOf("--count") + 1]) || 1 : 1;
  const upper = args.includes("--upper");
  const hex = args.includes("--hex");
  const toClipboard = args.includes("--to-clipboard");

  const uuids: string[] = [];
  for (let i = 0; i < count; i++) {
    const uuid = hex ? crypto.randomUUID().replace(/-/g, "") : crypto.randomUUID();
    uuids.push(upper ? uuid.toUpperCase() : uuid);
  }

  const result = uuids.join("\n");

  if (toClipboard) {
    writeClipboard(result);
    guohub_text_print("已复制到剪贴板");
  } else {
    guohub_text_print(result);
  }
}
