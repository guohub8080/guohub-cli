import jsQR from "jsqr";
import { Jimp } from "jimp";
import { readClipboardImageAsync, writeClipboard } from "#common_js/clipboard.js";
import {
  guohub_logger,
  guohub_json_print,
  guohub_error_print,
} from "#common_js/log.js";
import { existsSync } from "node:fs";

function parseArgs(args: string[]) {
  let filePath = "";
  let fromClipboard = false;
  let toClipboard = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--from-clipboard":
        fromClipboard = true;
        break;
      case "--to-clipboard":
        toClipboard = true;
        break;
      case "-h":
      case "--help":
        guohub_error_print(
          "用法: scan-qrcode [图片路径] [选项]\n" +
            "  --from-clipboard   从剪贴板读取图片\n" +
            "  --to-clipboard     识别后将内容复制到剪贴板\n" +
            "\n示例:\n" +
            "  guohub-cli scan-qrcode ~/qr.png\n" +
            "  guohub-cli scan-qrcode -p\n" +
            "  guohub-cli scan-qrcode -p -c\n"
        );
        break;
      default:
        if (!arg.startsWith("-") && !filePath) {
          filePath = arg;
        }
        break;
    }
  }

  return { filePath, fromClipboard, toClipboard };
}

async function decodeQRCode(imageData: Buffer, width: number, height: number): Promise<string | null> {
  const clamped = new Uint8ClampedArray(imageData);
  const result = jsQR(clamped, width, height);
  return result?.data ?? null;
}

export async function main(args: string[]) {
  const { filePath, fromClipboard, toClipboard } = parseArgs(args);

  let image: InstanceType<typeof Jimp>;
  let source = "";

  if (filePath) {
    if (!existsSync(filePath)) {
      guohub_error_print(`文件不存在: ${filePath}`);
    }
    image = await Jimp.read(filePath);
    source = filePath;
    guohub_logger.info(`已读取图片: ${filePath} (${image.bitmap.width}x${image.bitmap.height})`);
  } else if (fromClipboard) {
    const img = await readClipboardImageAsync();
    if (!img) {
      guohub_error_print("剪贴板中没有图片");
    }
    image = await Jimp.fromBuffer(img);
    source = "剪贴板";
    guohub_logger.info(`已从剪贴板读取图片 (${image.bitmap.width}x${image.bitmap.height})`);
  } else {
    guohub_error_print("请提供图片路径或使用 -p 从剪贴板读取");
  }

  // @ts-ignore - image is assigned in all branches above but TS doesn't narrow through guohub_error_print
  const content = await decodeQRCode(
    Buffer.from(image.bitmap.data),
    image.bitmap.width,
    image.bitmap.height
  );

  if (!content) {
    guohub_error_print("未识别到二维码");
  }

  if (toClipboard) {
    writeClipboard(content);
    guohub_logger.info("已复制识别结果到剪贴板");
  }

  guohub_json_print({
    is_success: true,
    source,
    content,
    to_clipboard: toClipboard,
  });
}
