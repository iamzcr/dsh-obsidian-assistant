# dsh-obsidian-assistant

DeepSeek Harness 插件（Cordis toolset）：操作本地 Obsidian 知识库（vault），提供搜索、读写笔记、双向链接 / 关系图谱、批量整理，并通过 Obsidian 的 "Local REST API" 社区插件调用高级能力（高速全文搜索、触发命令 / 模板）。

> 一套插件，双通道，统一操作同一个 vault：不依赖 Obsidian 运行也能读写（文件通道），Obsidian 在线时自动增强（REST 通道）。

---

## 功能一览（11 个工具）

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

本插件是一个 **profile bundle**。完整、可操作的接入步骤见 [`DEPLOY.md`](./DEPLOY.md)。核心是在你的 profile 里追加本 bundle，或在 profile 的 `cordis.patch.yml` 里 `insert` 一条插件条目并指定 `config.vaultPath`：

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml（顶层数组里追加）
- insert:
    - id: obsidian-assistant
      name: 'dsh-obsidian-assistant'
      config:
        vaultPath: 'D:/my-notes'            # 必填：vault 根目录（含 .obsidian 的目录）
        apiUrl: 'https://127.0.0.1:27124'   # 可选：Local REST API（默认 https + 自签名）
        apiToken: ''                        # 可选：Local REST API 插件设置的 API Key
        enableRestApi: true                 # 可选：是否启用通道 B
        excludePatterns: ['.obsidian', '.trash']
        maxResults: 50                      # 可选：文件通道搜索返回上限
```

> 本插件 `inject: ["tools", "fs"]`，依赖 base bundle 提供的 `tools` 与 `fs` 服务，因此必须挂在 base bundle 之后（base 天然是第一个 bundle）。

### 配置项

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `vaultPath` | ✅ | — | vault 根目录绝对路径（正斜杠） |
| `apiUrl` | | `https://127.0.0.1:27124` | Local REST API 地址 |
| `apiToken` | | `""` | Local REST API 的 API Key（每个 vault 独立） |
| `enableRestApi` | | `true` | 是否启用通道 B（不可用自动降级） |
| `excludePatterns` | | `[]` | 排除目录（前缀匹配或 `*` 通配） |
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

## 开发

```bash
npm install
npm run build       # 编译到 lib/
npm run smoke       # 核心逻辑冒烟测试（不依赖 harness）
npm run test:int    # 集成测试（验证 11 工具注册 + execute）
npm run rest:smoke  # 通道 B 实时冒烟（需 OBSIDIAN_API_KEY / OBSIDIAN_API_URL 环境变量）
```

`rest:smoke` 用法：

```bash
OBSIDIAN_API_KEY=<key> OBSIDIAN_API_URL=https://127.0.0.1:27124 npm run rest:smoke
```

## 目录结构

```
src/
  index.ts   插件入口（name/inject/Config/apply + 11 个工具注册）
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
