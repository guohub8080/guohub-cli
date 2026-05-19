import QRCode from "qrcode";
import { Jimp } from "jimp";
import { readClipboard, writeClipboardImage } from "#common_js/clipboard.js";
import {
  guohub_logger,
  guohub_json_print,
  guohub_error_print,
} from "#common_js/log.js";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";

function sanitizeFilename(text: string): string {
  const s = text.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return s.length > 30 ? s.slice(0, 30) + "..." : s;
}

function parseArgs(args: string[]) {
  let content = "";
  let fromClipboard = false;
  let outputPath = "";
  let toClipboard = false;
  let format: "png" | "svg" = "png";
  let size = 300;
  let margin = 4;
  let logoPath = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--from-clipboard":
        fromClipboard = true;
        break;
      case "--output":
        outputPath = args[++i] ?? "";
        break;
      case "--to-clipboard":
        toClipboard = true;
        break;
      case "--format": {
        const f = (args[++i] ?? "").toLowerCase();
        if (f === "svg" || f === "png") {
          format = f;
        } else {
          guohub_error_print(`不支持的格式: ${f}，仅支持 png、svg`);
        }
        break;
      }
      case "--size": {
        const n = parseInt(args[++i] ?? "", 10);
        if (!isNaN(n) && n > 0) size = n;
        break;
      }
      case "--logo":
        logoPath = args[++i] ?? "";
        break;
      case "--margin": {
        const n = parseInt(args[++i] ?? "", 10);
        if (!isNaN(n) && n >= 0) margin = n;
        break;
      }
      case "-h":
      case "--help":
        guohub_error_print(
          "用法: gen-qrcode [内容] [选项]\n" +
            "  --from-clipboard   从剪贴板读取内容\n" +
            "  --output <路径>    输出到指定文件\n" +
            "  --to-clipboard     输出到剪贴板\n" +
            "  --format <格式>    png（默认）或 svg\n" +
            "  --size <像素>      图片尺寸，默认 300\n" +
            "  --margin <模块>    边距（模块数），默认 4\n" +
            "  --logo <路径>      在二维码中心叠加 Logo（仅 PNG）\n" +
            "\n示例:\n" +
            '  guohub-cli gen-qrcode "https://example.com"\n' +
            '  guohub-cli gen-qrcode "https://example.com" -o ~/qr.png\n' +
            "  guohub-cli gen-qrcode -p -c\n" +
            '  guohub-cli gen-qrcode "https://example.com" --logo ~/logo.png\n'
        );
        break;
      default:
        if (!arg.startsWith("-") && !content) {
          content = arg;
        }
        break;
    }
  }

  return { content, fromClipboard, outputPath, toClipboard, format, size, margin, logoPath };
}

async function compositeLogo(qrBuffer: Buffer, logoPath: string): Promise<Buffer> {
  const qrImage = await Jimp.read(qrBuffer);
  const logo = await Jimp.read(logoPath);

  // Logo 占二维码宽度的 18%（经验值，兼顾可见性和扫描成功率）
  const logoSize = Math.round(qrImage.bitmap.width * 0.18);
  await logo.resize({ w: logoSize });

  const x = Math.round((qrImage.bitmap.width - logo.bitmap.width) / 2);
  const y = Math.round((qrImage.bitmap.height - logo.bitmap.height) / 2);

  qrImage.composite(logo, x, y);
  return await qrImage.getBuffer("image/png");
}

export async function main(args: string[]) {
  const { content: argContent, fromClipboard, outputPath, toClipboard, format, size, margin, logoPath } =
    parseArgs(args);

  let content = argContent;
  if (!content && fromClipboard) {
    content = readClipboard();
    guohub_logger.info("已从剪贴板读取内容");
  }

  if (!content) {
    guohub_error_print("未提供二维码内容，传入文本参数或使用 -p 从剪贴板读取");
  }

  if (logoPath && format === "svg") {
    guohub_error_print("--logo 仅支持 PNG 格式，SVG 无法叠加位图 Logo");
  }

  if (logoPath && !existsSync(logoPath)) {
    guohub_error_print(`Logo 文件不存在: ${logoPath}`);
  }

  const ext = format === "svg" ? ".svg" : ".png";
  const defaultToClipboard = !outputPath;
  const shouldClipboard = toClipboard || defaultToClipboard;
  const finalPath = outputPath || "";

  if (format === "svg") {
    const svg = await QRCode.toString(content, { type: "svg", width: size });

    if (finalPath) {
      writeFileSync(finalPath, svg, "utf-8");
      guohub_logger.info(`SVG 已保存: ${finalPath}`);
    }

    if (shouldClipboard) {
      const { Clipboard } = await import("@napi-rs/clipboard"); const clip = new Clipboard();
      clip.setText(svg);
      guohub_logger.info("SVG 已复制到剪贴板");
    }
  } else {
    // 有 Logo 时自动提升纠错级别到 H
    const qrOptions: QRCode.QRCodeToBufferOptions = {
      type: "png",
      width: size,
      errorCorrectionLevel: logoPath ? "H" : "M",
      margin,
    };

    let buffer = await QRCode.toBuffer(content, qrOptions);

    if (logoPath) {
      buffer = await compositeLogo(buffer, logoPath);
      guohub_logger.info("已叠加 Logo，纠错级别: H");
    }

    if (finalPath) {
      writeFileSync(finalPath, buffer);
      guohub_logger.info(`PNG 已保存: ${finalPath}`);
    }

    if (shouldClipboard) {
      try {
        writeClipboardImage(buffer);
        guohub_logger.info("PNG 已复制到剪贴板");
      } catch {
        guohub_error_print("写入剪贴板失败，可能被其他程序占用");
      }
    }
  }

  guohub_json_print({
    is_success: true,
    format,
    size,
    margin,
    logo: logoPath || null,
    error_correction_level: logoPath ? "H" : "M",
    path: finalPath || null,
    to_clipboard: shouldClipboard,
  });
}
