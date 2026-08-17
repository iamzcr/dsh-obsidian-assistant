# dsh-obsidian-assistant

A DeepSeek Harness plugin (Cordis toolset) that operates a local Obsidian vault: search, read/write notes, backlink / graph queries, batch organization, and access to advanced capabilities through Obsidian's "Local REST API" community plugin (fast full-text search, triggering commands / templates).

> One plugin, two channels, one vault: read and write works without Obsidian running (file channel); when Obsidian is online the plugin automatically upgrades through the REST channel.

---

## Features (12 tools)

### Channel A · Direct file access (always available, no Obsidian required)

| Tool | Description |
|---|---|
| `obsidian_search` | Full-text / title search, optional `tag` filter; returns path + snippet + tags |
| `obsidian_read_note` | Read a single note (frontmatter + body), with or without the `.md` extension |
| `obsidian_create_note` | Create a note (optional YAML frontmatter; refuses to overwrite an existing note) |
| `obsidian_update_note` | Literal string replacement / append editing (idempotent, safe) |
| `obsidian_list_structure` | Folder tree + tag statistics + orphan notes |
| `obsidian_backlinks` | Backlinks + outgoing links + tag membership graph |
| `obsidian_batch` | Batch move / rename with automatic `[[wikilink]]` rewriting across the vault |
| `obsidian_export_novel` | Export chapter notes named `第X章-标题` into clean TXT / Markdown manuscripts ordered by chapter number, ready to paste into a novel platform |

### Channel B · Local REST API (requires Obsidian running + the community plugin installed)

| Tool | Description |
|---|---|
| `obsidian_rest_search` | Fast full-text search through Obsidian's own index (preferred for large vaults) |
| `obsidian_list_commands` | List Obsidian commands (id + name) |
| `obsidian_run_command` | Trigger a command (Templater / Dataview re-render, etc.) |
| `obsidian_rest_query` | Pass-through to arbitrary REST endpoints (fallback / advanced use) |

> **Dataview note**: the Local REST API has no native dataview endpoint. To run a dataview query, find the relevant command id via `obsidian_list_commands`, then trigger it with `obsidian_run_command`.

---

## Installation & Registration

This plugin is a **profile bundle**. For complete, actionable steps see [`DEPLOY.md`](./DEPLOY.md). The two core steps:

1. Add `dsh-obsidian-assistant` to the profile's bundles list (`dsh.profile.bundles` in `$DSH_HOME/profiles/<name>/package.json`);
2. Give it a `vaultPath` in the profile's `cordis.patch.yml` (the only required field — there is no portable default, so it is intentionally not preset in the bundle):

```yaml
# append to the top-level array in $DSH_HOME/profiles/<name>/cordis.patch.yml
- id: dsh-obsidian-assistant
  config:
    vaultPath: 'D:/my-notes'            # required: absolute path to the vault root (forward slashes)
    # all of the following are optional and have defaults:
    # apiUrl: 'https://127.0.0.1:27124'
    # apiToken: ''
    # enableRestApi: true
    # excludePatterns: ['.obsidian', '.trash']
    # maxResults: 50
```

> This plugin declares `inject: ["tools", "fs"]` and depends on the `tools` and `fs` services provided by the base bundle, so it must be mounted after the base bundle (the base is naturally the first bundle).

### Configuration options

| Field | Required | Default | Description |
|---|---|---|---|
| `vaultPath` | ✅ | — | Absolute path to the vault root (forward slashes) |
| `apiUrl` | | `https://127.0.0.1:27124` | Local REST API base URL |
| `apiToken` | | `""` | Local REST API key (unique per vault) |
| `enableRestApi` | | `true` | Whether channel B is enabled (degrades gracefully when unavailable) |
| `excludePatterns` | | `['.obsidian', '.trash']` | Excluded directories (prefix match or `*` wildcard) |
| `maxResults` | | `50` | Max matches returned by the file-channel search |

> ⚠️ **Self-signed certificate**: the Local REST API serves HTTPS with a self-signed certificate by default. This plugin already tolerates it at the request layer (`node:https` with `rejectUnauthorized: false`), so no extra environment variables are needed.

---

## Key behaviors

- **Path safety**: every path must be vault-relative; escapes (`../`) are always rejected.
- **Move = rewrite links**: `obsidian_batch`'s `move` rewrites every `[[oldName]]` wikilink across the vault to `[[newName]]` (matching Obsidian's rename behavior) and reports how many links were updated.
- **Exclusion rules**: `excludePatterns` supports directory-name prefix matches and `*` wildcards.
- **Orphans**: `obsidian_list_structure` treats a note with neither incoming nor outgoing links as an orphan.
- **Two-channel fallback**: when the REST API is unavailable, all read/write operations automatically fall back to the file channel with no perceptible degradation.

## Known limitations

- The harness `FileSystem` service exposes no `delete`/`rename` API, so `move` under the harness `ctx.fs` backend is "copy + empty the source" (`sourceRemoved: false`); only under the pure Node fallback is it a true `rename` (`sourceRemoved: true`). No data is lost, but an empty file may remain at the source location.
- The Local REST API has no native dataview endpoint (see above).

---

## Novel export (`obsidian_export_novel`)

Exports vault chapter notes named **`第X章-标题`** into manuscripts that can be **pasted directly into a serialized-novel platform backend** (Qidian / Fanqie / Jinjiang / Zongheng / Feilu, etc.). Zero risk: no browser automation, no touching platform anti-cheat / rate-limit systems.

**Behavior**
- **Chapter detection**: filenames matching `第X章` (Chinese or Arabic numerals) or bare-number chapters (`12. Title`).
- **Ordering**: ascending by parsed chapter number; frontmatter's `章节` field is ignored (it is often inconsistent with the filename).
- **Exclusion**: `exclude` drops whole chapters (by number) or specific drafts (by path/title substring); duplicates/drafts of a skipped chapter number are skipped too.
- **Cleaning**: automatically removes YAML frontmatter, `#` heading markers, `>` blockquotes, `**bold**`/`*italic*`, `~~strikethrough~~`, images/links/`[[wikilink]]`, footnotes, HTML comments and list markers, keeping the prose. Fenced and inline code are kept by default (`includeCode: false` strips them).
- **Output**: written under `<outDir>/<bookName>_<UTC timestamp>/`, one `.txt` and/or `.md` file per chapter.

**Parameters**

| Parameter | Default | Description |
|---|---|---|
| `format` | `both` | `txt` / `markdown` / `both` — output format per chapter |
| `folder` | whole vault | Optional vault-relative subdirectory to scan (e.g. `小说`) |
| `query` | none | Optional substring to filter chapters by path/title |
| `exclude` | none | Optional chapters to skip. A number or `第X章` entry excludes that whole chapter number (all its duplicates/drafts); any other entry excludes by path/title substring (case-insensitive) |
| `includeCode` | `true` | Keep fenced and inline code verbatim; set `false` to strip code for platforms that mangle it |
| `outDir` | `导出` | Output directory (vault-relative path) |
| `bookName` | last segment of `folder` / `小说` | Used to name the output folder |

Example (ask the model in a session):
```
把 小说/ 目录下的章节导出成 txt 方便我发布到起点
```
Equivalent to `obsidian_export_novel({ folder: "小说", format: "txt" })`, producing `导出/小说_2026-08-17_153000/第一章-xxx.txt ...`.

To exclude drafts / duplicate chapters (e.g. the vault has two "第三章" and two "他的浪漫代码"):
```
导出 小说，但排除第 3 章和标题带 "浪漫代码" 的废稿
```
Equivalent to `obsidian_export_novel({ folder: "小说", format: "txt", exclude: ["3", "浪漫代码"] })`.

> The English README covers the same content as the Chinese one; the tool names and Chinese example text are intentionally kept verbatim so they match what a model session would actually use.

## Development

```bash
npm install
npm run build       # compile to lib/
npm run smoke       # core-logic smoke tests (no harness required)
npm run test:int    # integration tests (12 tools registered + execute)
npm run rest:smoke  # live channel-B smoke tests (requires OBSIDIAN_API_KEY / OBSIDIAN_API_URL env vars)
```

`rest:smoke` usage:

```bash
OBSIDIAN_API_KEY=<key> OBSIDIAN_API_URL=https://127.0.0.1:27124 npm run rest:smoke
```

## Project layout

```
src/
  index.ts   plugin entry (name / inject / Config / apply + 12 tools registered)
  export.ts  novel export (chapter detection / ordering / cleaning / TXT + Markdown rendering)
  vault.ts   VaultService (channel A: read-write / graph / batch / link rewriting / exclusion / path guards)
  rest.ts    ObsidianApiClient (channel B: probe + search / commands / passthrough, self-signed cert tolerated via node:https)
scripts/
  smoke.mjs        core-logic smoke tests
  integration.mjs  integration tests (mock ctx.fs/ctx.tools, verifies tool registration + execute)
  rest-smoke.mjs   channel-B live smoke tests (key passed via env vars)
fixtures/vault/    sample test-vault notes
cordis.patch.yml   bundle patch (inserts the plugin entry)
SKILL.md           model-visible skill instructions
DEPLOY.md          complete integration guide
```

## License

MIT