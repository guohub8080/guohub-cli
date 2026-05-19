# GuoHub CLI

通用 CLI 工具集，用于增强 Claude Code 的系统功能。基于 TypeScript + Python 混合构建，兼容 macOS 和 Windows。

## 快速开始

```bash
# 安装依赖（postinstall 会自动执行 doctor 检查环境）
pnpm install

# 全局安装
npm link
guohub-cli <command>
```

## 可用命令

| 命令 | 语言 | 说明 |
|------|------|------|
| **扩展浏览器** | | |
| `use-ex-browser` | Python | 启动/获取浏览器实例，支持 `--open-url`、`--tab-index`、`--replace` |
| `find-ex-browser` | Python | 查看所有运行中的浏览器实例 |
| `ex-browser-close` | Python | 安全关闭指定项目的浏览器 |
| `ex-browser-project` | Python | 项目管理（list / add / remove / info） |
| `set/get-browser-global-key` | Python | 全局凭据管理 |
| `set/get-browser-project-key` | Python | 项目凭据管理 |
| **文档处理** | | |
| `extract-img` | Python | 从 Word 文档中提取图片 |
| `extract-pptx-img` | Python | 从 PPTX 中提取所有图片 |
| `img-to-pptx` | Python | 图片合成为 PPTX |
| `merge-pdf` | Python | 合并为 PDF |
| **图片处理** | | |
| `compress-img` | Python | 压缩图片 |
| `img-format` | Python | 图片格式转换 |
| `trim-transparent` | Python | 裁剪 PNG 透明边缘 |
| `gen-qrcode` | TS | 生成二维码 |
| `scan-qrcode` | TS | 识别二维码 |
| **系统工具** | | |
| `gen-password` | TS | 生成随机密码 |
| `open-folder` | TS | 在文件管理器中打开文件夹 |
| `fix-chinese-quote` | TS | 修复中文引号 |
| `make-zip` | Python | 创建 ZIP 压缩包 |
| `safe-delete` | Python | 安全删除（回收站/废纸篓） |
| `modify-meta-time` | Python | 修改文件元数据时间 |
| **网络工具** | | |
| `email-sender` | TS | 发送邮件 |
| `motrix-download` | TS | Motrix 下载管理 |
| `wechat-*` | TS | 微信公众号管理 |
| **环境** | | |
| `doctor` | Python | 安装依赖并检查环境 |

## 项目结构

```
guohub-cli/
├── cli.ts                 # CLI 统一入口
├── scripts/
│   ├── common_js/         # Node.js 公共模块（log、clipboard、keyring）
│   ├── common_py/         # Python 公共模块（log、keyring）
│   ├── fix_py_env/        # 环境修复、依赖安装
│   ├── doc_tool/          # 文档处理
│   ├── image_tool/        # 图片处理
│   ├── system_tool/       # 系统工具
│   ├── text_tool/         # 文本处理
│   └── web_tool/
│       ├── browser_manager/  # 扩展浏览器（ExBrowser）
│       ├── email_sender/     # 邮件发送
│       └── motrix_download/  # 下载管理
├── plugins/               # 插件目录（按需安装）
└── templates/             # 模板文件
```

## 技术栈

- **TypeScript** — CLI 核心（tsx 运行时编译，无构建步骤）
- **Python** — 部分命令（uv 管理依赖）
- **keyring** — 敏感凭据存储到系统密钥链
- **Playwright** — 浏览器自动化（CDP attach 模式）

## License

MIT
