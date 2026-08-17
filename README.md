# dsh-obsidian-assistant

DeepSeek Harness 插件（Cordis toolset）：操作本地 Obsidian 知识库（vault），提供搜索、读写笔记、双向链接 / 关系图谱、批量整理，并通过 Obsidian 的 "Local REST API" 社区插件调用高级能力（高速全文搜索、触发命令 / 模板）。

> 一套插件，双通道，统一操作同一个 vault：不依赖 Obsidian 运行也能读写（文件通道），Obsidian 在线时自动增强（REST 通道）。

---

## 功能一览（12 个工具）

### 通道 A · 文件直读写（始终可用，不依赖 Obsidian 运行）

| 工具 | 说明 |
|---|---|
| `obsidian_search` | 全文 / 标题检索，支持按 `tag` 过滤，返回路径 + 片段 + 标签 |
| `obsidian_read_note` | 读单篇笔记（frontmatter + 正文），可带 / 不带 `.md` 后缀 |
| `obsidian_create_note` | 新建笔记（可带 YAML frontmatter，拒绝覆盖已存在笔记） |
| `obsidian_update_note` | 字面量替换 / 追加编辑（幂等、安全） |
| `obsidian_list_structure` | 文件夹树 + 标签统计 + 孤立笔记 |
| `obsidian_backlinks` | 反向链接 + 出链 + tag 归属图谱 |
| `obsidian_batch` | 批量移动 / 重命名，自动重写全库 `[[wikilink]]` |
| `obsidian_export_novel` | 把 vault 里按 `第X章-标题` 命名的章节笔记，清洗成可粘贴到小说平台的 TXT / Markdown 文稿，按章号排序落盘 |

### 通道 B · Local REST API（需 Obsidian 运行 + 安装该社区插件）

| 工具 | 说明 |
|---|---|
| `obsidian_rest_search` | Obsidian 内部索引高速全文搜索（大库首选） |
| `obsidian_list_commands` | 列出 Obsidian 命令（id + 名称） |
| `obsidian_run_command` | 触发命令（Templater / Dataview 重渲染等） |
| `obsidian_rest_query` | 透传任意 REST 端点（兜底 / 高级用法） |

> **Dataview 说明**：Local REST API 无原生 dataview 端点，dataview 查询需通过 `obsidian_list_commands` 找到 Dataview 命令 id，再用 `obsidian_run_command` 触发。

---

## 安装与注册

本插件是一个 **profile bundle**。完整、可操作的接入步骤见 [`DEPLOY.md`](./DEPLOY.md)。核心两步：

1. 把 `dsh-obsidian-assistant` 加进 profile 的 bundles 列表（`$DSH_HOME/profiles/<name>/package.json` 的 `dsh.profile.bundles`）；
2. 在 profile 的 `cordis.patch.yml` 里为它指定 `vaultPath`（唯一必填项，没有可移植的默认值，所以 bundle 里不预设）：

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml（顶层数组里追加）
- id: dsh-obsidian-assistant
  config:
    vaultPath: 'D:/my-notes'            # 必填：vault 根目录绝对路径（正斜杠）
    # 以下均为可选，有默认值：
    # apiUrl: 'https://127.0.0.1:27124'
    # apiToken: ''
    # enableRestApi: true
    # excludePatterns: ['.obsidian', '.trash']
    # maxResults: 50
```

> 本插件 `inject: ["tools", "fs"]`，依赖 base bundle 提供的 `tools` 与 `fs` 服务，因此必须挂在 base bundle 之后（base 天然是第一个 bundle）。

### 配置项

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `vaultPath` | ✅ | — | vault 根目录绝对路径（正斜杠） |
| `apiUrl` | | `https://127.0.0.1:27124` | Local REST API 地址 |
| `apiToken` | | `""` | Local REST API 的 API Key（每个 vault 独立） |
| `enableRestApi` | | `true` | 是否启用通道 B（不可用自动降级） |
| `excludePatterns` | | `['.obsidian', '.trash']` | 排除目录（前缀匹配或 `*` 通配） |
| `maxResults` | | `50` | 文件通道搜索最大命中数 |

> ⚠️ **自签名证书**：Local REST API 默认 HTTPS + 自签名，本插件已在请求层用 `node:https`（`rejectUnauthorized: false`）容忍，无需额外设置环境变量。

---

## 关键行为

- **路径安全**：所有路径必须是 vault 相对路径，逃逸（`../`）一律拒绝。
- **移动 = 重写链接**：`obsidian_batch` 的 `move` 会把全库中 `[[旧名]]` 自动改写为 `[[新名]]`（对齐 Obsidian rename 行为），并返回更新了几处链接。
- **排除规则**：`excludePatterns` 支持目录名前缀匹配和 `*` 通配。
- **孤立笔记**：`obsidian_list_structure` 的 orphan 判定 = 既无入链也无出链。
- **双通道降级**：REST API 不可用时所有读写自动走文件模式，无感知降级。

## 已知限制

- harness 的 `FileSystem` 服务无 `delete`/`rename` API，因此 `move` 在 harness `ctx.fs` 后端下是「复制 + 源文件清空」（`sourceRemoved: false`），在纯 Node fallback 下才是真正的 `rename`（`sourceRemoved: true`）。数据不会丢失，但源位置可能残留空文件。
- Local REST API 无原生 dataview 端点（见上）。

---

## Obsidian 小说导出（`obsidian_export_novel`）

用于把 vault 里按 **`第X章-标题`** 命名的小说章节笔记，导出成**可直接粘贴到小说平台后台**（起点 / 番茄 / 晋江 / 纵横 / 飞卢 等）的文稿，零风险（不做浏览器自动化、不触碰平台风控）。

**行为**
- **识别章节**：文件名匹配 `第X章`（支持中文数字与阿拉伯数字）或裸数字章节（`12. 标题`）。
- **排序**：按解析出的章号升序排序，不以 frontmatter 的 `章节` 字段为准（该字段常与文件名不一致）。
- **排除**：`exclude` 可排掉整章（章号）或指定废稿（路径/标题子串），命中章号的重复/草稿一并跳过。
- **清洗**：自动去掉 YAML frontmatter、`#` 标题标记、`>` 引用、`**粗体**`/`*斜体*`、`~~删除~~`、图片/链接/`[[wikilink]]`、脚注、HTML 注释与列表记号，保留正文；代码块 / 行内代码默认保留（`includeCode: false` 时整体去除）。
- **落盘**：写入 vault 的 `<outDir>/<书名>_<UTC时间戳>/` 文件夹，每章一个 `.txt` 和/或 `.md` 文件。

**参数**

| 参数 | 默认 | 说明 |
|---|---|---|
| `format` | `both` | `txt` / `markdown` / `both`，每章产出对应格式文件 |
| `folder` | 全库 | 可选，限定扫描的 vault 相对子目录（如 `小说`） |
| `query` | 无 | 可选，按路径/标题子串过滤章节 |
| `exclude` | 无 | 可选，排除章节。数字或 `第X章` 项排除整个章号（含其所有重复/草稿）；其他项按路径/标题子串（忽略大小写）排除废稿 |
| `includeCode` | `true` | 是否保留代码块与行内代码 |
| `outDir` | `导出` | 输出目录（vault 相对路径） |
| `bookName` | folder 末段 / `小说` | 用来命名输出文件夹 |

示例（在会话里让模型执行）：
```
把 小说/ 目录下的章节导出成 txt 方便我发布到起点
```
等价于调用 `obsidian_export_novel({ folder: "小说", format: "txt" })`，产出 `导出/小说_2026-08-17_153000/第一章-xxx.txt ...`。

排除草稿/重复章节（例如库里有两份「第三章」、两份「他的浪漫代码」）：
```
导出 小说，但排除第 3 章和标题带 "浪漫代码" 的废稿
```
等价于 `obsidian_export_novel({ folder: "小说", format: "txt", exclude: ["3", "浪漫代码"] })`。

## 开发

```bash
npm install
npm run build       # 编译到 lib/
npm run smoke       # 核心逻辑冒烟测试（不依赖 harness）
npm run test:int    # 集成测试（验证 12 工具注册 + execute）
npm run rest:smoke  # 通道 B 实时冒烟（需 OBSIDIAN_API_KEY / OBSIDIAN_API_URL 环境变量）
```

`rest:smoke` 用法：

```bash
OBSIDIAN_API_KEY=<key> OBSIDIAN_API_URL=https://127.0.0.1:27124 npm run rest:smoke
```

## 目录结构

```
src/
  index.ts   插件入口（name/inject/Config/apply + 12 个工具注册）
  export.ts  小说导出（章节识别/排序/清洗/TXT+Markdown 渲染）
  vault.ts   VaultService（通道 A：读写/图谱/批量/链接重写/排除/路径防护）
  rest.ts    ObsidianApiClient（通道 B：探测 + 搜索/命令/透传，node:https 容忍自签名）
scripts/
  smoke.mjs        核心逻辑冒烟测试
  integration.mjs  集成测试（mock ctx.fs/ctx.tools 验证工具注册 + execute）
  rest-smoke.mjs   通道 B 实时冒烟（环境变量传 key）
fixtures/vault/    测试用 vault 示例笔记
cordis.patch.yml   bundle patch（insert 插件条目）
SKILL.md           模型可见的技能指令
DEPLOY.md          完整接入步骤
```

## License

MIT
