import { execSync } from "node:child_process";

function getClipboard() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Clipboard } = require("@napi-rs/clipboard") as typeof import("@napi-rs/clipboard");
  return new Clipboard();
}

export function readClipboard(): string {
  try {
    return getClipboard().getText();
  } catch {
    try {
      if (process.platform === "darwin") return execSync("pbpaste", { encoding: "utf-8" }).trim();
      if (process.platform === "win32") return execSync("powershell -command Get-Clipboard", { encoding: "utf-8" }).trim();
    } catch {}
    return "";
  }
}

export function writeClipboard(text: string) {
  try {
    getClipboard().setText(text);
  } catch {
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (process.platform === "win32") {
      execSync("clip", { input: text });
    }
  }
}

export async function readClipboardImageAsync(): Promise<Buffer | null> {
  if (process.platform === "win32") {
    return winPowershellReadImg();
  }
  try {
    const data = getClipboard().getImage();
    if (data && data.length > 0) return data;
  } catch {}
  return null;
}

function winPowershellReadImg(): Buffer | null {
  const ps = `Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $stream = [System.IO.MemoryStream]::new()
  $img.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  [Convert]::ToBase64String($stream.ToArray())
  $stream.Dispose()
} else {
  exit 0
}`;
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const result = execSync(`powershell -EncodedCommand ${encoded}`, { encoding: "utf-8" }).trim();
  if (!result) return null;
  return Buffer.from(result, "base64");
}

export function writeClipboardImage(buffer: Buffer) {
  const b64 = buffer.toString("base64");
  if (process.platform === "win32") {
    writeClipboardImageWin32(b64);
  } else if (process.platform === "darwin") {
    writeClipboardImageMac(b64);
  } else {
    throw new Error(`不支持的平台: ${process.platform}`);
  }
}

function writeClipboardImageWin32(b64: string) {
  const ps =
    `try { ` +
    `Add-Type -Assembly System.Windows.Forms, System.Drawing; ` +
    `$bytes = [Convert]::FromBase64String('${b64}'); ` +
    `$stream = [System.IO.MemoryStream]::new($bytes); ` +
    `$img = [System.Drawing.Image]::FromStream($stream); ` +
    `[System.Windows.Forms.Clipboard]::SetImage($img); ` +
    `$img.Dispose(); $stream.Dispose() ` +
    `} catch { Write-Error $_; exit 1 }`;
  execSync(`powershell -command "${ps}"`, { maxBuffer: b64.length * 2 });
}

function writeClipboardImageMac(b64: string) {
  const jxa =
    `ObjC.import('Cocoa');` +
    `var d=$.NSData.alloc.initWithBase64EncodedStringOptions('${b64}',0);` +
    `if(!d||d.length===0){exit(1)}` +
    `var img=$.NSImage.alloc.initWithData(d);` +
    `if(!img){exit(1)}` +
    `var pb=$.NSPasteboard.generalPasteboard;` +
    `pb.clearContents;` +
    `var ok=pb.writeObjects([img]);` +
    `if(!ok){exit(1)}`;
  execSync(`osascript -l JavaScript -e '${jxa}'`, { maxBuffer: b64.length * 2 });
}
