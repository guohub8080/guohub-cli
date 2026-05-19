# 扩展浏览器（ExBrowser）

每个项目（Project）对应一个独立的 Chrome 实例，互不干扰：
- 独立的用户数据目录（cookies、登录态、扩展、书签）
- 独立的 CDP 端口（通过 `cdp_url` 连接 Playwright）
- 独立的凭据（`credential_keys`，自动从 keyring 注入环境变量）
- 独立的监控守护进程（记录 API 请求、Console 日志、资源）

典型场景：
- 用 `default` 项目日常浏览
- 用 `wechat-archi` 和 `wechat-tech` 两个项目分别登录不同的微信公众号，避免登录态冲突，下次打开自动复用各自的 cookies

## 项目与凭据管理

系统默认存在一个 `default` 项目，无法删除。当不指定 `--project` 参数时，所有命令自动 fallback 到 `default` 项目。

每个项目对应一个独立的 Chrome 实例，互不干扰：
- 独立的用户数据目录（cookies、登录态、扩展、书签）
- 独立的 CDP 端口
- 独立的凭据（credential_keys，值存储在系统密钥链中）
- 独立的监控守护进程

### 项目管理

```bash
# 列出所有项目
guohub-cli ex-browser-project list

# 创建项目
guohub-cli ex-browser-project add <项目名>
guohub-cli ex-browser-project add <项目名> --description "描述" --browser chrome --proxy http://127.0.0.1:7890

# 查看项目详情（配置、凭据、实例状态）
guohub-cli ex-browser-project info <项目名>

# 删除项目（清理配置 + 凭据 + 数据目录，default 无法删除）
guohub-cli ex-browser-project remove <项目名>
```

**`default` 项目说明：**
- 始终存在，无法删除
- 不指定 `--project` 时自动使用
- 首次 `use-ex-browser` 时自动创建数据目录

### 凭据管理

每个项目可以关联凭据（credential_keys）。Key 是凭据的标识名，配合系统密钥链（keyring）用来安全获取密码、Token、API Key 等敏感信息，避免明文写在配置文件中。

**存储方式：**
- **标识名**（key）：存储在 `config.toml` 中，非敏感，只是一个名字
- **凭据值**（value）：通过 keyring 安全存储在系统密钥链中（macOS Keychain / Windows Credential Manager），敏感信息绝不落地到文件

#### 全局凭据 vs 项目凭据

- **全局凭据**：所有项目共享，适合通用 API Key（如 `deepseek-key`）。配置在 `config.toml` 的顶层 `browser_global_keys` 字段
- **项目凭据**：仅某个项目使用，适合专属登录凭据（如 `wechat-token`）。配置在 `config.toml` 的项目段落中 `browser_project_keys` 字段

启动实例时，两者合并（项目凭据优先），体现在输出的 `credential_keys` 字段中。

#### 设置凭据

```bash
# 推荐方式：从剪贴板读取（敏感数据不经过 LLM）
guohub-cli set-browser-global-key <key> --from-clipboard

# 直接指定值（会暴露给 LLM，仅限非敏感数据使用）
guohub-cli set-browser-global-key <key> --set-value <值>

# 覆盖已有的凭据（不加 --force 时，已存在的 key 会报错）
guohub-cli set-browser-global-key <key> --from-clipboard --force
```

项目凭据同理，需额外指定 `--project`：

```bash
guohub-cli set-browser-project-key --project <项目名> <key> [--from-clipboard] [--set-value <值>] [--force]
```

**在代码中使用凭据：** 不要通过 CLI 查看，直接在代码中通过 keyring 读取：

```python
from scripts.common_py.keyring_helper import guohub_get_credential
token = guohub_get_credential("wechat-token")
```

## 场景 1：我想启动一个浏览器，用 Playwright 自动化操作

```bash
# 启动默认项目
guohub-cli use-ex-browser

# 启动并打开指定页面（新标签页）
guohub-cli use-ex-browser --open-url https://twitter.com

# 指定项目名（不同项目完全隔离）
guohub-cli use-ex-browser --project wechat --open-url https://mp.weixin.qq.com

# 替换指定标签页内容（不新开标签）
guohub-cli use-ex-browser --open-url https://facebook.com --tab-index 0 --replace
```

如果项目已有实例在运行，会自动复用并通过 CDP 协议操作页面（默认新标签页）。如果守护进程（daemon）已停止，也会自动重启。命令输出 JSON，其中 `cdp_url` 就是 Playwright 连接地址：
```typescript
const browser = await chromium.connectOverCDP("http://127.0.0.1:56789");
```

## 场景 2：用完了，安全关闭浏览器

```bash
# 关闭 default 项目
guohub-cli ex-browser-close

# 关闭指定项目
guohub-cli ex-browser-close --project wechat
```

会安全终止该项目的守护进程和浏览器主进程。只关闭通过 guohub-cli 启动的浏览器（通过 `--user-data-dir` 精确匹配），不影响用户手动打开的其他 Chrome。

## 场景 3：我不确定浏览器是否已经开了，想获取连接信息

```bash
guohub-cli use-ex-browser --project <项目名>
```

直接执行即可。如果该项目已有实例在运行，**不会重复启动**，只返回当前实例的 `cdp_port`、`cdp_url` 等信息。如果没运行，则自动启动。

## 场景 4：我想看看当前有多少个浏览器实例在跑

```bash
guohub-cli find-ex-browser
```

列出所有由 guohub-cli 启动的带监控的浏览器实例：

```json
{
  "count": 2,
  "browsers": [
    {
      "project": "default",
      "cdp_port": 9222,
      "cdp_url": "http://127.0.0.1:9222",
      "pid": 12345,
      "browser": "Chrome/131.0.0.0",
      "is_alive": true,
      "daemon_running": true
    },
    {
      "project": "wechat",
      "cdp_port": 9333,
      "cdp_url": "http://127.0.0.1:9333",
      "pid": 67890,
      "browser": "Chrome/131.0.0.0",
      "is_alive": true,
      "daemon_running": false
    }
  ]
}
```

## 场景 5：我想抓包，看看页面发了什么 API 请求

先启动浏览器，拿到输出中的 `api_url`：

```bash
# 查看所有 API 请求和响应
curl <api_url>
```

守护进程会自动记录页面上所有网络请求。在浏览器里操作后，再次 curl 即可看到新增的请求。

## 场景 6：页面有报错，我想看 Console 日志

```bash
# 查看 Console 日志和页面错误
curl <console_log_url>
```

## 场景 7：我想批量下载页面上的图片/视频等资源

资源监控默认关闭（避免占用内存），需要手动开启：

```bash
# 1. 开启资源下载
curl <download_on_url>

# 2. 在浏览器里浏览页面，资源会被自动记录

# 3. 查看已捕获的资源列表
curl <resources_url>

# 4. 用完后关闭，释放内存
curl <download_off_url>
```

## 输出字段说明

启动后 stdout 输出 JSON：

```json
{
  "project": "wechat",
  "browser": "Chrome/147.0.7727.138",
  "pid": 12345,
  "cdp_port": 56789,
  "cdp_url": "http://127.0.0.1:56789",
  "credential_keys": ["wechat-token", "deepseek-key"],
  "api_url": "http://127.0.0.1:56801/api",
  "resources_url": "http://127.0.0.1:56801/resources",
  "console_log_url": "http://127.0.0.1:56801/console",
  "download_on_url": "http://127.0.0.1:56801/download/on",
  "download_off_url": "http://127.0.0.1:56801/download/off",
  "prompt": "给 LLM 的操作指引"
}
```

| 字段 | 说明 |
|------|------|
| `cdp_url` | Playwright 连接地址 |
| `credential_keys` | 该项目的凭据标识列表（值从 keyring 读取） |
| `api_url` | API 请求/响应日志端点 |
| `console_log_url` | Console 日志端点 |
| `resources_url` | 静态资源元数据端点（需先 `download_on`） |
| `download_on_url` | 开启资源捕获 |
| `download_off_url` | 关闭资源捕获 |
