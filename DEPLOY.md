# 如何接入并使用 `dsh-obsidian-assistant`

本插件是 DeepSeek Harness 的一个 **profile bundle**，通过 harness 的 profile 系统加载。下面是完整、可操作的接入步骤（基于你机器上运行的 `dsh` 版本 `0.1.0-rc.6` 验证过的机制）。

## 前置条件

1. 一个已安装的 DeepSeek Harness（`dsh` CLI 可用，`$DSH_HOME` 已初始化）。
2. 一个本地 Obsidian vault（含 `.obsidian` 目录的文件夹），记下其**绝对路径**，例如 `D:/my-notes`。
3. （可选，用于通道 B）Obsidian 内安装 "Local REST API" 社区插件，记下端口与 token。

## 方式 A：作为 bundle 接入（推荐，发布后最省事）

本插件已声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。发布到 npm 后（或本地 `npm pack` 后 install），把它加进你的 profile：

```bash
# 1. 用现有 profile（例如 web），或新建一个
dsh plugin --profile web add dsh-obsidian-assistant

# 2. 若上面命令不存在该子命令，则手动编辑 profile 清单：
#    $DSH_HOME/profiles/web/package.json
```

手动方式（等价于上一步）——编辑 `$DSH_HOME/profiles/web/package.json`，在 `dsh.profile.bundles` 数组里追加一行：

```json
{
  "name": "dsh-profile-web",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-obsidian-assistant"
      ]
    }
  }
}
```

然后在该 profile 目录下安装它：

```bash
cd $DSH_HOME/profiles/web
pnpm add dsh-obsidian-assistant
```

> ⚠️ **必须配置 `vaultPath`**：bundle patch 不预设 `vaultPath`（没有可移植的默认值）。装好后，还需在 profile 的 `cordis.patch.yml` 里为它指定 vault 路径，否则插件加载时报 `vaultPath is required`：
>
> ```yaml
> # $DSH_HOME/profiles/web/cordis.patch.yml（顶层数组里追加）
> - id: dsh-obsidian-assistant
>   config:
>     vaultPath: 'D:/my-notes'   # 改成你的真实 vault 绝对路径
> ```

## 方式 B：作为用户 patch 层接入（不改 bundle 列表，最灵活、适合开发调试）

在你的 profile 的 `cordis.patch.yml`（`$DSH_HOME/profiles/web/cordis.patch.yml`）里追加一条 `insert`，直接挂载插件条目，并在此处覆盖 `config`：

```yaml
# 已存在的顶层数组里追加：
- insert:
    - id: dsh-obsidian-assistant
      name: 'dsh-obsidian-assistant'
      config:
        # 必填：改成你的真实 vault 绝对路径
        vaultPath: 'D:/my-notes'
        apiUrl: 'https://127.0.0.1:27124'
        apiToken: ''
        enableRestApi: true
        excludePatterns: ['.obsidian', '.trash']
        maxResults: 50
```

配套：确保该包能被 profile 目录解析到（`npm/pnpm link` 或 install 到 profile 的 `node_modules`）。

> 注意：**绝对路径用正斜杠**，不要用反斜杠（YAML 中转义易错）。`vaultPath` 是唯一必填项。

## 启动并验证

```bash
# 启动 web 界面（或 headless）
dsh --profile web
```

启动后在 Web GUI（默认 http://127.0.0.1:3080）里对模型说：

- 「搜索我的笔记里关于 XX 的内容」→ 触发 `obsidian_search`
- 「读一下《笔记名》」→ 触发 `obsidian_read_note`
- 「新建一篇笔记叫 ...」→ 触发 `obsidian_create_note`
- 「谁引用了《笔记名》」→ 触发 `obsidian_backlinks`

也可以在会话里直接让模型调用，例如：

```
用 obsidian_list_structure 看看我的知识库结构
```

## 验证插件已加载

启动日志中应出现 `dsh-obsidian-assistant` 插件的加载记录，且模型可用工具集里多出 11 个 `obsidian_*` 工具。若未出现，常见原因：

1. **配置没生效**：确认 patch 里的 `vaultPath` 是绝对路径、无 YAML 缩进错误。
2. **包没解析到**：确认 profile 的 `node_modules` 里有 `dsh-obsidian-assistant`（`ls $DSH_HOME/profiles/web/node_modules/dsh-obsidian-assistant`）。
3. **inject 缺失**：本插件 `inject: ["tools", "fs"]`，需挂在 base bundle（提供 `tools` 与 `fs` 服务）之后；base 是第一个 bundle，天然满足。

## 本地开发闭环（不改 harness，先验证代码）

```bash
cd dsh-obsidian-assistant
npm install
npm run build       # 编译到 lib/
npm run smoke       # 核心逻辑冒烟测试（8 项）
npm run test:int    # 集成测试（28 项：11 工具注册 + 读写/图谱/批量/链接重写/排除/路径防护）
```

## 配置项速查

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `vaultPath` | ✅ | — | vault 根目录绝对路径 |
| `apiUrl` | | `https://127.0.0.1:27124` | Local REST API 地址 |
| `apiToken` | | `""` | Local REST API token |
| `enableRestApi` | | `true` | 是否启用通道 B（不可用时自动降级） |
| `excludePatterns` | | `['.obsidian', '.trash']` | 排除目录（配合 `.obsidian`、`.trash`） |
| `maxResults` | | `50` | 搜索最大命中数 |
