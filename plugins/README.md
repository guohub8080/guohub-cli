# Plugins

插件目录，每个子目录是一个独立插件。

## 安装插件

```bash
cd plugins
git clone <私有仓库地址> <插件名>
cd ..
pnpm install
pnpm dev doctor
```

## 插件结构

```
plugins/<插件名>/
├── plugin.json    # 必须存在，声明命令和依赖
├── package.json   # 可选，声明额外 Node 依赖
└── ...            # 脚本文件
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
