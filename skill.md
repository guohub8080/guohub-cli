---
name: guohub
description: 通用 CLI 工具集，作者 guohub8080
---

# GuoHub CLI

通用 CLI 工具集，涵盖文档处理、图片处理、系统工具、网络工具等常见任务。

## 首次使用

当用户首次触发本 skill 时，检查 `.venv` 目录是否存在：

- **不存在**：询问用户「本项目需要 Python 环境，是否执行初始化？(`uv init` + 安装依赖)」
- **已存在**：跳过，直接使用

初始化（在项目目录下执行）：

```bash
uv init --bare
pnpm install
pnpm dev doctor
```

## 前置条件

- Node.js + pnpm
- uv 已安装（`uv --version` 检查）

## 功能模块

### 系统工具（system_tool）

#### open-folder

在系统文件管理器中打开指定文件夹。

```bash
guohub-cli open-folder <路径>
```

- macOS 调用 `open`，Windows 调用 `explorer`
- 传入文件路径时自动打开其所在目录

#### gen-password

生成随机密码，可配置字符类型和长度。

```bash
guohub-cli gen-password --length <长度> --no-upper --no-lower --no-symbols  # 纯数字
guohub-cli gen-password --length <长度> --no-digits --no-symbols            # 纯字母
guohub-cli gen-password --count <数量>                                      # 生成多个
guohub-cli gen-password --to-clipboard                                      # 复制到剪贴板
```

参数：`--length`（默认 18）、`--no-upper/--no-lower/--no-digits/--no-symbols`、`--to-clipboard`、`--all-symbols`

#### make-zip

将文件或文件夹打包为 zip，自动排除系统垃圾文件。

```bash
guohub-cli make-zip <目录/>                           # 打包文件夹
guohub-cli make-zip <文件1> <文件2> --output out.zip  # 打包多个文件
guohub-cli make-zip <目录/> --exclude <排除项>         # 排除特定文件
```

参数：`--output`、`--exclude`（支持多个）

- 默认排除 `.DS_Store`、`__MACOSX`、`._*`、`Thumbs.db`、`desktop.ini`
- 大目录打包时每 5 秒打印进度

#### modify-meta-time

修改文件的创建时间、修改时间、访问时间。

```bash
guohub-cli modify-meta-time <文件> --show                         # 查看当前时间
guohub-cli modify-meta-time <文件> --birthtime "2024-06-01 12:30" # 修改创建时间
guohub-cli modify-meta-time <文件> --set-all "2024-01-15"         # 同时修改所有时间
guohub-cli modify-meta-time <文件> --set-all now                  # 用当前时间
```

参数：`--birthtime`、`--mtime`、`--atime`、`--set-all`、`--show`

时间格式：`YYYY-MM-DD`、`YYYY-MM-DD HH:MM`、`YYYY-MM-DD HH:MM:SS`、`now`

#### safe-delete

安全删除文件/文件夹（移到回收站/废纸篓，非永久删除）。

```bash
guohub-cli safe-delete <文件或目录>
```

- Windows 移到回收站，macOS 移到废纸篓

### 图片处理（image_tool）

#### compress-img

压缩图片体积或缩小尺寸，超过限制时自动缩减。

```bash
guohub-cli compress-img <图片> --max-size 200                              # 压缩到 200KB 以内
guohub-cli compress-img <图片> --max-width 800                             # 限制最大宽度
guohub-cli compress-img <图片> --max-size 100 --max-width 600 --max-height 400
guohub-cli compress-img <图片> --max-size 50 --output <输出路径>
guohub-cli compress-img <目录/> --max-size 200                             # 批量处理
```

参数：`--max-size`（KB）、`--max-width/--max-height`（px）、`--quality`（默认 85）、`--format`、`--output`、`--suffix`

- 策略：先缩尺寸 → 降 JPEG 质量 → PNG 转 JPEG 兜底
- 不指定 `--output` 时，默认后缀为压缩后的体积数（如 `photo-672K.jpg`）

#### img-format

将图片转换为不同格式。

```bash
guohub-cli img-format <图片> --format PNG             # 转 PNG
guohub-cli img-format <图片> --output <输出路径>       # 自动推断格式
guohub-cli img-format <目录/> --format WEBP            # 批量转换
guohub-cli img-format <图片> --format JPEG --quality 90
```

参数：`--format`（JPEG/PNG/WEBP/BMP/TIFF/ICO/GIF）、`--quality`（默认 85）、`--output`

- 支持 7 种格式互转
- 自动处理 RGBA→RGB 转换

#### gen-qrcode

将文本或链接生成 QR Code 图片，默认输出到剪贴板。

```bash
guohub-cli gen-qrcode --from-clipboard                        # 从剪贴板读取，生成到剪贴板
guohub-cli gen-qrcode "https://example.com"                   # 直接传入文本
guohub-cli gen-qrcode "https://example.com" --output qr.png   # 保存到文件
guohub-cli gen-qrcode "https://example.com" --format svg      # SVG 格式
guohub-cli gen-qrcode "https://example.com" --logo ~/logo.png # 中心叠加 Logo
```

参数：`--from-clipboard`、`--to-clipboard`（默认）、`--output`、`--format`（png/svg）、`--size`（默认 300）、`--margin`（默认 4）、`--logo`（仅 PNG）

- 不指定 `--output` 时默认输出到剪贴板
- 叠加 Logo 时自动提升纠错级别到 H

#### scan-qrcode

从图片中识别 QR Code 内容。

```bash
guohub-cli scan-qrcode --from-clipboard                    # 从剪贴板读取图片
guohub-cli scan-qrcode --from-clipboard --to-clipboard     # 识别后复制到剪贴板
guohub-cli scan-qrcode ~/qr.png                            # 从文件读取
```

参数：`--from-clipboard`、`--to-clipboard`、位置参数（图片文件路径）

#### trim-transparent

裁剪 PNG 图片的透明边缘。

```bash
guohub-cli trim-transparent <图片>              # 裁剪透明边缘
guohub-cli trim-transparent <图片> --output <路径> # 指定输出路径
guohub-cli trim-transparent <目录/>              # 批量处理
```

### 文本处理（text_tool）

#### fix-chinese-quote

将英文直引号转为中文弯引号，并可检查引号是否闭合。

```bash
guohub-cli fix-chinese-quote --file <文件>                         # 从文件修复
guohub-cli fix-chinese-quote --from-clipboard --to-clipboard       # 剪贴板进出
echo '<文本>' | guohub-cli fix-chinese-quote                       # 管道输入
guohub-cli fix-chinese-quote --check --file <文件>                  # 只检查不修复
```

- 修复模式：直引号交替转为左右弯引号
- 检查模式（`--check`）：检测未闭合等问题，有问题 exit 1，通过 exit 0
- 支持文件、剪贴板、管道三种输入

### 文档处理（doc_tool）

#### extract-img

从 `.docx` 或 `.doc` 文件中提取所有嵌入图片，自动压缩超过 1MB 的图片。

```bash
guohub-cli extract-img <文档.docx|文档.doc>
guohub-cli extract-img <文档> --output /path/to/output
```

- 支持 `.docx`（ZIP 解析）和 `.doc`（二进制签名扫描）
- 自动压缩超过 1MB 的图片，自动去重，跳过碎片文件（< 1KB）

#### extract-pptx-img

从 PPTX 中提取所有图片。

```bash
guohub-cli extract-pptx-img <演示文稿.pptx>
guohub-cli extract-pptx-img <演示文稿.pptx> --output /path/to/output
```

#### img-to-pptx

将一组图片按自然排序合成为 PPTX，每页一张图，幻灯片尺寸自动匹配第一张图片。

```bash
guohub-cli img-to-pptx <图片目录>
guohub-cli img-to-pptx <图片目录> --output <输出.pptx>
guohub-cli img-to-pptx <图片目录> --ext .png .jpg
```

参数：`-o/--output`、`--ext`（默认 `.png .jpg .jpeg .bmp .gif .webp`）

- 按自然排序（`幻灯片1` → `幻灯片10`），非字典序
- 每张图片铺满整页，无白边

#### merge-pdf

将图片、PDF 或混合文件夹合并为单个 PDF。

```bash
guohub-cli merge-pdf <文件或目录> [--output <输出.pdf>]
```

### 网络工具（web_tool）

#### motrix-download

通过 Motrix RPC 管理下载任务。

```bash
guohub-cli motrix-download setup --host <地址> --port <端口> --read-token-from-clipboard
guohub-cli motrix-download add <URL> [--output 文件名]
guohub-cli motrix-download list
guohub-cli motrix-download status <gid>
```

#### email-sender

支持多账户管理的邮件发送工具。

```bash
guohub-cli email-sender setup --account work --host smtp.gmail.com --port 587 --from me@gmail.com --from-clipboard --from-name "我的名字"
guohub-cli email-sender send --to user@example.com --subject "测试" --body "邮件内容"
guohub-cli email-sender send --account work --to a@ex.com --to b@ex.com --subject "通知" --body "<h1>Hello</h1>" --html
guohub-cli email-sender list
guohub-cli email-sender remove --account work
```

参数：`--account`、`--host`、`--port`（默认 587）、`--from`、`--from-name`、`--password`、`--no-tls`、`--to`（可多次）、`--subject`、`--body`、`--html`

- 多账户管理，支持默认账户自动选择
- SMTP 密码存系统密钥链，config.toml 只存非敏感配置

##### 邮件账户管理

```bash
guohub-cli set-email-key --account <账户名> <key> [--set-value <值>] [--from-clipboard] [--force]
guohub-cli get-email-key --account <账户名> [key]
guohub-cli remove-email-account --account <账户名>
```

#### 扩展浏览器（Ex Browser）

当用户需要浏览器自动化（Playwright）、抓包调试（查看 API 请求/响应）、监控 Console 日志、批量下载页面资源等操作时，使用扩展浏览器。每个项目对应独立的 Chrome 实例（cookies、CDP 端口、凭据、监控守护进程完全隔离）。详见 `scripts/web_tool/browser_manager/instruction.md`。

```bash
guohub-cli use-ex-browser                                    # 启动 default 项目
guohub-cli use-ex-browser --open-url https://twitter.com      # 启动并打开页面
guohub-cli use-ex-browser --project <项目名>                   # 指定项目
guohub-cli use-ex-browser --open-url <url> --tab-index 0 --replace  # 替换指定标签页
guohub-cli find-ex-browser                                   # 查看所有正在运行的浏览器实例
guohub-cli ex-browser-project list                           # 列出所有项目
guohub-cli ex-browser-project add <项目名>                    # 创建项目
guohub-cli ex-browser-project info <项目名>                   # 查看项目详情
guohub-cli ex-browser-project remove <项目名>                 # 删除项目
guohub-cli ex-browser-close                                  # 安全关闭 default 项目浏览器
guohub-cli ex-browser-close --project <项目名>                # 安全关闭指定项目浏览器
```

首次启动某个项目时会创建 Chrome 实例；再次执行相同项目时，复用已有实例（保持登录态）。当不确定某个项目是否已启动、或需要获取 CDP 端口信息时，直接执行该命令即可——它不会重复启动，只会返回当前实例的连接信息。

项目管理：

```bash
guohub-cli set-browser-global-key <key> [--set-value <值>] [--from-clipboard] [--force]
guohub-cli get-browser-global-key [key]
guohub-cli set-browser-project-key --project <项目名> <key> [--set-value <值>] [--from-clipboard] [--force]
guohub-cli get-browser-project-key --project <项目名> [key]
guohub-cli remove-browser-project <项目名>
```

### 微信公众号（wechat）

#### 账户管理

```bash
guohub-cli wechat-account setup --appid <AppID> --appsecret <AppSecret>
guohub-cli wechat-account list
guohub-cli wechat-account remove --account <账户名>
```

#### 素材管理

```bash
guohub-cli wechat-upload <图片路径> [--account <账户名>]  # 上传图片到素材库
guohub-cli wechat-upload --from-clipboard                  # 从剪贴板上传

guohub-cli wechat-material list [--account <账户名>]       # 查看素材列表
guohub-cli wechat-material get <media_id>                  # 获取素材详情
guohub-cli wechat-material delete <media_id>               # 删除素材
```

#### 草稿管理

```bash
guohub-cli wechat-draft list                               # 列出草稿
guohub-cli wechat-draft get <media_id>                     # 获取草稿详情
guohub-cli wechat-draft create --title <标题> --content <内容>  # 新建草稿
guohub-cli wechat-draft update <media_id> --title <标题> --content <内容>
guohub-cli wechat-draft delete <media_id>                  # 删除草稿
```

### 环境与维护

#### doctor

安装依赖并配置凭据。

```bash
guohub-cli doctor
```

## 触发词

| 用户说 | 使用命令 |
|--------|---------|
| "打开文件夹"、"打开目录"、"在 Finder 中打开" | `open-folder` |
| "生成密码"、"随机密码" | `gen-password` |
| "打包"、"创建 zip"、"打包成 zip" | `make-zip` |
| "修改时间"、"改创建时间"、"改文件日期" | `modify-meta-time` |
| "安全删除"、"移到回收站" | `safe-delete` |
| "压缩图片"、"缩小图片"、"图片太大" | `compress-img` |
| "转格式"、"图片转换"、"PNG转JPG"、"转WEBP" | `img-format` |
| "生成二维码"、"QR Code" | `gen-qrcode` |
| "识别二维码"、"扫描二维码"、"扫描 QR Code" | `scan-qrcode` |
| "裁剪透明边缘"、"去透明边距" | `trim-transparent` |
| "修复引号"、"检查引号"、"中文引号" | `fix-chinese-quote` |
| "提取图片"、"Word 图片"、"文档图片" | `extract-img` |
| "提取 PPTX 图片"、"PPTX 图片" | `extract-pptx-img` |
| "图片转 PPT"、"合成 PPT"、"做成 PPT" | `img-to-pptx` |
| "合并 PDF"、"图片转 PDF" | `merge-pdf` |
| "发邮件"、"发送邮件"、"邮件通知" | `email-sender` |
| "下载"、"Motrix" | `motrix-download` |
| "启动浏览器"、"打开浏览器"、"远程调试"、"抓包"、"监控网络" | `use-ex-browser` |
| "浏览器实例"、"哪些浏览器"、"浏览器列表" | `find-ex-browser` |
| "浏览器项目"、"新建项目"、"删除项目" | `ex-browser-project` |
| "上传微信"、"微信公众号" | `wechat-upload` |
| "微信素材" | `wechat-material` |
| "微信草稿" | `wechat-draft` |

## 脚本组合调用

所有命令通过剪贴板无缝串联：

```bash
# 识别二维码 → 重新生成二维码
guohub-cli scan-qrcode --from-clipboard --to-clipboard
guohub-cli gen-qrcode --from-clipboard

# 从 Word 提取图片 → 压缩 → 上传微信
guohub-cli extract-img document.docx
guohub-cli compress-img extracted_images/ --max-size 200
guohub-cli wechat-upload --from-clipboard

# 生成密码 → 发送邮件
guohub-cli gen-password --to-clipboard
guohub-cli email-sender send --to user@example.com --subject "密码" --body "<from clipboard>"

# 生成带 Logo 的二维码 → 压缩
guohub-cli gen-qrcode "https://example.com" --logo logo.png -o qr.png
guohub-cli compress-img qr.png --max-size 100
```

核心机制：`--to-clipboard` 的输出天然成为下一个脚本 `--from-clipboard` 的输入，无需中间文件。
