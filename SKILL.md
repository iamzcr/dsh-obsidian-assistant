---
name: obsidian-assistant
description: 操作本地 Obsidian 知识库：搜索、读写笔记、查询双向链接与关系图谱、批量整理，并可通过 Obsidian Local REST API 调用高级能力。
whenToUse: 当用户要求查找、阅读、创作、编辑、分析或整理其本地 Obsidian vault 中的笔记时使用。
---

# Obsidian 知识库操作规范

本技能通过 `obsidian_*` 工具操作一个本地 Obsidian vault（知识库）。

## 可用工具

| 工具 | 用途 |
|---|---|
| `obsidian_search` | 全文/标题检索（支持 `tag` 过滤），返回路径 + 片段 + 标签 |
| `obsidian_read_note` | 读单篇笔记（正文 + frontmatter） |
| `obsidian_create_note` | 新建笔记（可带 frontmatter） |
| `obsidian_update_note` | 字面量替换编辑 / 追加 |
| `obsidian_list_structure` | 文件夹树 + 标签统计 + 孤立笔记 |
| `obsidian_backlinks` | 反向链接、出链与 tag 归属图谱 |
| `obsidian_batch` | 批量移动/重命名（自动重写内部 `[[链接]]`） |
| `obsidian_rest_query` | 透传 Local REST API 任意端点（通道 B） |
| `obsidian_rest_search` | Obsidian 内部索引高速全文搜索（通道 B，适合大库） |
| `obsidian_list_commands` | 列出 Obsidian 命令（id + 名称，通道 B） |
| `obsidian_run_command` | 触发 Obsidian 命令（Templater / Dataview 重渲染等，通道 B） |

## 使用规则（务必遵守）

1. **路径边界**：所有路径都是 vault 相对路径（正斜杠，可省略 `.md` 后缀）。绝对不要拼接到 vault 之外的路径。
2. **先读后改**：编辑或覆盖前先 `obsidian_read_note` 确认现状，保留已有 frontmatter 字段。
3. **frontmatter 规范**：新增字段用合法 YAML；`tags` 用数组，别名用 `aliases`，创建时间用 `created`。
4. **双向链接**：`[[笔记名]]` 用不含扩展名的笔记名；`[[笔记名#标题]]` 指向小节；`![[笔记名]]` 为嵌入。
5. **标签**：`#kebab-case` 或 `#嵌套/标签`。
6. **写作工具**：只读工具 `obsidian_search`/`read_note`/`list_structure`/`backlinks` 无需审批即可用；写工具 `create_note`/`update_note`/`batch` 优先走 harness 文件系统真实写入。

## 双通道说明

- **通道 A（文件直读写）**：始终可用，通过 harness 文件系统服务读写 vault 里的 `.md`。
- **通道 B（Local REST API）**：当 Obsidian 正在运行且安装了 "Local REST API" 社区插件时自动可用。用于高速全文搜索（`obsidian_rest_search`）、触发命令/模板（`obsidian_run_command` + `obsidian_list_commands`）。不可用时自动降级到通道 A，无需向用户解释技术细节。
- **Dataview 查询**：Local REST API 无原生 dataview 端点。需要 dataview 时，先 `obsidian_list_commands` 找到 dataview 相关命令 id，再用 `obsidian_run_command` 触发它。

## 典型任务流程

- **"找到讲 XX 的笔记"**：`obsidian_search(query="XX")` → 对命中的路径 `obsidian_read_note`。（库很大时优先 `obsidian_rest_search`）
- **"新建一篇 XX 笔记"**：`obsidian_create_note(path="XX", content="...", frontmatter={tags:[...]})`。
- **"谁引用了这篇笔记"**：`obsidian_backlinks(note="笔记名")`。
- **"整理库结构"**：`obsidian_list_structure` 先看树与孤立笔记，再 `obsidian_batch` 移动。
- **"跑一下 XX 模板/命令"**：`obsidian_list_commands` 找命令 id → `obsidian_run_command(commandId=...)`。
