import { program } from "commander";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { runPython } from "./scripts/common_js/run_python.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

// 计算项目根目录并注入到进程环境变量，所有子模块和 Python 子进程都能读到
let dir = currentDir;
while (!existsSync(join(dir, "pyproject.toml"))) {
  const parent = dirname(dir);
  if (parent === dir) {
    process.stderr.write("无法找到项目根目录 (pyproject.toml)\n");
    process.exit(1);
  }
  dir = parent;
}
process.env.GUOHUB_ROOT = dir;

type CommandRun = (args: string[]) => void | Promise<void>;

// 核心命令（硬编码）
const coreCommands: Record<string, { desc: string; run: CommandRun }> = {
  // TS commands
  "gen-password": {
    desc: "生成随机密码",
    run: async (args) => { (await import("./scripts/system_tool/gen_password/script.js")).main(args); },
  },
  "open-folder": {
    desc: "在文件管理器中打开文件夹",
    run: async (args) => { (await import("./scripts/system_tool/open_folder/script.js")).main(args); },
  },
  "fix-chinese-quote": {
    desc: "修复中文引号",
    run: async (args) => { (await import("./scripts/text_tool/fix_chinese_quote/script.js")).main(args); },
  },
  "motrix-download": {
    desc: "通过 Motrix RPC 管理下载任务",
    run: async (args) => { (await import("./scripts/web_tool/motrix_download/motrix_download.js")).main(args); },
  },
  "email-sender": {
    desc: "发送邮件（支持多账户管理）",
    run: async (args) => { (await import("./scripts/web_tool/email_sender/email_cli.js")).main(args); },
  },
  "set-email-key": {
    desc: "设置邮件账户自定义凭据（更新 config.toml 和 keyring）",
    run: async (args) => { (await import("./scripts/web_tool/email_sender/set_email_key.js")).main(args); },
  },
  "get-email-key": {
    desc: "获取邮件账户自定义凭据",
    run: async (args) => { (await import("./scripts/web_tool/email_sender/get_email_key.js")).main(args); },
  },
  "remove-email-account": {
    desc: "删除邮件账户（清理 config.toml 和 keyring 凭据）",
    run: async (args) => { (await import("./scripts/web_tool/email_sender/remove_email_account.js")).main(args); },
  },
  "wechat-account": {
    desc: "微信公众号账户管理（配置 AppID/AppSecret）",
    run: async (args) => { (await import("./scripts/wechat_public/account.js")).main(args); },
  },
  "wechat-upload": {
    desc: "上传图片到微信公众号素材库",
    run: async (args) => { (await import("./scripts/wechat_public/upload.js")).main(args); },
  },
  "wechat-material": {
    desc: "微信公众号素材管理（查看/下载/删除）",
    run: async (args) => { (await import("./scripts/wechat_public/material.js")).main(args); },
  },
  "wechat-draft": {
    desc: "微信公众号草稿管理（列表/获取/新建/更新/删除）",
    run: async (args) => { (await import("./scripts/wechat_public/draft.js")).main(args); },
  },
  "gen-qrcode": {
    desc: "生成二维码图片（支持 PNG/SVG，可输出到文件或剪贴板）",
    run: async (args) => { (await import("./scripts/image_tool/gen_qrcode.js")).main(args); },
  },
  "scan-qrcode": {
    desc: "识别二维码图片（支持文件或剪贴板）",
    run: async (args) => { (await import("./scripts/image_tool/scan_qrcode.js")).main(args); },
  },

  // Python commands
  "doctor": {
    desc: "安装依赖并配置凭据",
    run: (args) => runPython("scripts/fix_py_env/doctor.py", args),
  },
  "extract-img": {
    desc: "从 Word 文档中提取图片",
    run: (args) => runPython("scripts/doc_tool/extract_img.py", args),
  },
  "extract-pptx-img": {
    desc: "从 PPTX 中提取所有图片",
    run: (args) => runPython("scripts/doc_tool/extract_pptx_img.py", args),
  },
  "img-to-pptx": {
    desc: "将图片合成为 PPTX（每页一张图）",
    run: (args) => runPython("scripts/doc_tool/img_to_pptx.py", args),
  },
  "merge-pdf": {
    desc: "将图片、PDF 或混合文件夹合并为单个 PDF",
    run: (args) => runPython("scripts/doc_tool/merge_pdf.py", args),
  },
  "compress-img": {
    desc: "压缩图片",
    run: (args) => runPython("scripts/image_tool/compress_img.py", args),
  },
  "img-format": {
    desc: "图片格式转换",
    run: (args) => runPython("scripts/image_tool/img_formatter.py", args),
  },
  "trim-transparent": {
    desc: "裁剪 PNG 图片的透明边缘",
    run: (args) => runPython("scripts/image_tool/trim_transparent.py", args),
  },
  "modify-meta-time": {
    desc: "修改文件元数据时间",
    run: (args) => runPython("scripts/system_tool/modify_meta_time.py", args),
  },
  "make-zip": {
    desc: "创建 ZIP 压缩包",
    run: (args) => runPython("scripts/system_tool/make_zip.py", args),
  },
  "set-browser-global-key": {
    desc: "设置浏览器全局凭据标识（更新 config.toml 和 keyring）",
    run: (args) => runPython("scripts/web_tool/browser_manager/set_browser_global_key.py", args),
  },
  "get-browser-global-key": {
    desc: "获取浏览器全局凭据标识和 keyring 中的值",
    run: (args) => runPython("scripts/web_tool/browser_manager/get_browser_global_key.py", args),
  },
  "set-browser-project-key": {
    desc: "设置浏览器项目凭据标识（更新 config.toml 和 keyring）",
    run: (args) => runPython("scripts/web_tool/browser_manager/set_browser_project_key.py", args),
  },
  "get-browser-project-key": {
    desc: "获取浏览器项目凭据标识和 keyring 中的值",
    run: (args) => runPython("scripts/web_tool/browser_manager/get_browser_project_key.py", args),
  },
  "safe-delete": {
    desc: "安全删除文件/文件夹（Win 回收站 / macOS 废纸篓）",
    run: (args) => runPython("scripts/system_tool/safe_delete.py", args),
  },
  "find-ex-browser": {
    desc: "查找所有由 guohub-cli 启动的带监控的浏览器实例",
    run: (args) => runPython("scripts/web_tool/browser_manager/find_existing_browsers.py", args),
  },
  "use-ex-browser": {
    desc: "使用浏览器实例（已存在则复用，不存在则启动，可指定 --open-url 打开页面）",
    run: async (args) => { (await import("./scripts/web_tool/browser_manager/browser_manager.js")).main(args); },
  },
  "find-browser-path": {
    desc: "探测浏览器安装路径（--browser chrome|chromium|edge|brave）",
    run: async (args) => { (await import("./scripts/web_tool/browser_manager/browser_manager.js")).findBrowserPath(args); },
  },
  "ex-browser-project": {
    desc: "管理浏览器项目（list / add / remove / info）",
    run: (args) => runPython("scripts/web_tool/browser_manager/ex_browser_project.py", args),
  },
  "ex-browser-close": {
    desc: "安全关闭指定项目的浏览器实例和守护进程",
    run: (args) => runPython("scripts/web_tool/browser_manager/ex_browser_close.py", args),
  },
  "extract-auth": {
    desc: "从浏览器提取指定域名的认证信息（Cookie + LocalStorage + SessionStorage）",
    run: async (args) => { (await import("./scripts/web_tool/extract_auth.js")).main(args); },
  },
};

// 动态加载插件命令
function loadPlugins(root: string): Record<string, { desc: string; run: CommandRun }> {
  const pluginCommands: Record<string, { desc: string; run: CommandRun }> = {};
  const pluginsDir = join(root, "plugins");

  if (!existsSync(pluginsDir)) return pluginCommands;

  for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const metaPath = join(pluginsDir, plugin.name, "plugin.json");
    if (!existsSync(metaPath)) continue;

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    const pluginDir = join(pluginsDir, plugin.name);

    for (const cmd of meta.commands) {
      if (cmd.type === "ts") {
        const entryPath = join(pluginDir, cmd.entry);
        pluginCommands[cmd.name] = {
          desc: cmd.desc,
          run: async (args) => {
            const mod = await import(entryPath);
            mod.main(args);
          },
        };
      } else if (cmd.type === "py") {
        const scriptPath = `plugins/${plugin.name}/${cmd.entry}`;
        pluginCommands[cmd.name] = {
          desc: cmd.desc,
          run: (args) => runPython(scriptPath, args),
        };
      }
    }
  }

  return pluginCommands;
}

// 合并核心命令 + 插件命令
const pluginCommands = loadPlugins(dir);
const commands = { ...coreCommands, ...pluginCommands };

program.name("guohub-cli").description("GuoHub CLI").version("0.1.0");

for (const [name, { desc, run }] of Object.entries(commands)) {
  program
    .command(name)
    .description(desc)
    .argument("[args...]")
    .allowUnknownOption()
    .action(run);
}

program.parse();
