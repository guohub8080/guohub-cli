# Plugin 开发指引

本文档指导如何在 guohub-cli 中开发插件。

## 插件结构

```
plugins/<插件名>/
├── plugin.json       # 必须，声明命令和依赖
├── skill.md          # 必须，命令手册（AI 可读）
├── package.json      # 可选，声明额外 Node 依赖
├── paths.py          # 推荐，提供 ROOT 常量
└── ...               # 脚本文件
```

## plugin.json 格式

```json
{
  "name": "插件名",
  "version": "1.0.0",
  "description": "插件描述",
  "commands": [
    {
      "name": "命令名",
      "desc": "命令描述",
      "type": "ts | py",
      "entry": "相对插件根目录的入口文件路径"
    }
  ],
  "py_dependencies": []
}
```

## 环境与路径

- 环境变量 `GUOHUB_ROOT` 始终指向项目根目录
- 用 `from <插件名>.paths import ROOT` 获取根目录，**不要**用 `Path(__file__).parent.parent...`
- 插件内 Python 子进程必须继承完整 PYTHONPATH（root + plugins），由 `run_python.ts` 自动设置

## TS 优先原则

涉及浏览器操作（CDP 连接、Cookie 提取、Token 获取、页面自动化）的功能，**必须用 TypeScript 实现**，注册为 `type: "ts"` 命令。

Python 需要这些能力时，通过 `subprocess` 调用对应的 TS 命令拿结果，不要在 Python 中安装 Playwright。

### 示例

TS 命令负责浏览器操作：
```ts
// 连接 CDP → 提取 cookie → 保存到本地 → 输出结果
export async function main(args: string[]) {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const cookies = await browser.contexts()[0].cookies(url);
  // ... 处理并输出
}
```

Python 只调用 CLI 拿结果：
```python
def get_token_from_browser(cdp_port: int) -> str:
    cmd = ["node", str(ROOT / "bin.js"), "my-get-token-cmd", "--cdp-port", str(cdp_port)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return result.stdout.strip().splitlines()[-1]
```

### 为什么

- TS 侧已有 Playwright 依赖和 ex-browser 基础设施，Python 不需要重复安装
- 浏览器 profile 由 ex-browser 统一管理（`local_data/<project>/`），TS 命令天然与之集成
- 职责分离清晰：TS 管浏览器，Python 管业务逻辑

## 浏览器协作

1. **不要在插件目录下维护独立的浏览器 profile**（如 `edge_profile/`）
2. **不要硬编码 CDP 端口号**，不要自己扫描进程
3. 浏览器相关操作全部走 TS 命令，Python 通过 CLI 调用

### 插件本地数据

- **非浏览器数据**（token 缓存、下载数据库等）：放在插件自己的 `local_data/` 目录
- **浏览器 profile 数据**：由 ex-browser 统一管理，插件不要触碰
