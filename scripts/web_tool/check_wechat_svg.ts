import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  guohub_logger,
  guohub_json_print,
  guohub_error_print,
  guohub_text_print,
} from "#common_js/log.js";

// ─── 微信 SVG AttributeName 白名单（T/CASME 1609—2024 附录 A） ──
// 格式：{ 标签名小写: Set<允许的 attributeName 小写> }
const WHITELIST: Record<string, Set<string>> = {
  animate: new Set([
    "x", "y", "width", "height", "cx", "cy",
    "opacity", "d", "points",
    "stroke-width", "stroke-linecap", "stroke-dashoffset",
    "fill",
  ]),
  set: new Set(["visibility"]),
  animatetransform: new Set(["translate", "scale", "rotate", "skewx", "skewy"]),
  animatemotion: new Set(["path"]),
};

// 禁用的标签/属性
const BANNED_TAGS = new Set(["defs", "embed"]);
const BANNED_ATTRS = new Set(["id", "class", "href", "xlink:href"]);

// ─── 简易 XML 解析（不依赖第三方库） ──

interface SvgIssue {
  tag: string;
  attribute: string;
  line?: number;
  reason: string;
}

function parseAttributes(attrStr: string): Array<{ name: string; value: string }> {
  const attrs: Array<{ name: string; value: string }> = [];
  const re = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs.push({ name: m[1], value: m[2] ?? m[3] ?? "" });
  }
  return attrs;
}

function checkSvg(content: string): SvgIssue[] {
  const issues: SvgIssue[] = [];
  const lines = content.split("\n");

  const tagRe = /<([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let match;

  while ((match = tagRe.exec(content)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrStr = match[2];
    const selfClose = match[3];

    // 跳过 <?xml ...?> 和注释
    if (tagName === "?xml" || tagName === "!--") continue;

    // 计算行号
    const pos = match.index;
    let line = 1;
    for (let i = 0; i < pos; i++) {
      if (content[i] === "\n") line++;
    }

    // 检查禁用标签
    if (BANNED_TAGS.has(tagName)) {
      issues.push({
        tag: match[1],
        attribute: `<${match[1]}>`,
        line,
        reason: "标签被微信禁用",
      });
      continue;
    }

    // 解析属性
    const attrs = parseAttributes(attrStr);

    // 检查禁用属性
    for (const attr of attrs) {
      if (BANNED_ATTRS.has(attr.name.toLowerCase())) {
        issues.push({
          tag: match[1],
          attribute: attr.name,
          line,
          reason: `属性 ${attr.name} 被微信禁用`,
        });
      }
    }

    // 检查动画标签的 attributeName 白名单
    const tagLower = tagName.toLowerCase();
    if (tagLower in WHITELIST) {
      const allowed = WHITELIST[tagLower];
      for (const attr of attrs) {
        if (attr.name.toLowerCase() === "attributename") {
          const val = attr.value.trim().toLowerCase();
          // animatetransform 的 attributeName 固定为 "transform"，不算违规
          if (tagLower === "animatetransform" && val === "transform") continue;
          if (!allowed.has(val)) {
            issues.push({
              tag: match[1],
              attribute: `attributeName="${attr.value}"`,
              line,
              reason: `${match[1]} 的 attributeName="${attr.value}" 不在白名单中`,
            });
          }
        }
      }
    }

    // 检查 animatetransform 的 type 属性
    if (tagLower === "animatetransform") {
      for (const attr of attrs) {
        if (attr.name.toLowerCase() === "type") {
          const val = attr.value.trim().toLowerCase();
          if (!WHITELIST.animatetransform.has(val)) {
            issues.push({
              tag: match[1],
              attribute: `type="${attr.value}"`,
              line,
              reason: `animateTransform 的 type="${attr.value}" 不在白名单中`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// ─── CLI 入口 ──

export async function main(args: string[]) {
  let input = "";
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--file":
      case "-f": {
        const filePath = resolve(args[++i]);
        if (!existsSync(filePath)) {
          guohub_error_print(`文件不存在: ${filePath}`);
        }
        input = readFileSync(filePath, "utf-8");
        break;
      }
      case "--text":
      case "-t":
        input = args[++i];
        break;
      case "--json":
        jsonOutput = true;
        break;
    }
  }

  // 允许从 stdin 传入
  if (!input && args.length > 0 && !args[0].startsWith("-")) {
    const filePath = resolve(args[0]);
    if (existsSync(filePath)) {
      input = readFileSync(filePath, "utf-8");
    }
  }

  if (!input) {
    guohub_error_print(
      `用法: check-wechat-svg <文件路径> 或 --file <路径> 或 --text "<svg代码>" [--json]\n\n检查 SVG 代码中是否包含微信公众号不支持的动画属性。\n依据: T/CASME 1609—2024《融媒体SVG交互设计技术规范》附录 A`,
    );
  }

  guohub_logger.info("检查 SVG 兼容性...");
  const issues = checkSvg(input);

  if (jsonOutput) {
    guohub_json_print({
      compatible: issues.length === 0,
      issue_count: issues.length,
      issues,
    });
    return;
  }

  if (issues.length === 0) {
    guohub_text_print("✅ 全部通过：所有 SVG 动画属性均在微信公众号白名单内。");
    return;
  }

  guohub_error_print(
    `❌ 发现 ${issues.length} 个不兼容项：\n` +
      issues
        .map((i) => {
          const loc = i.line ? ` (第 ${i.line} 行)` : "";
          return `  - ${loc} <${i.tag}> ${i.attribute} — ${i.reason}`;
        })
        .join("\n"),
  );
}
