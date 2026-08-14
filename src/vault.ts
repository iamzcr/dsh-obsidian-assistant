import { dirname, isAbsolute, join, relative } from "node:path";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { FileSystem, FsTarget } from "@deepseek-ai/dsh-fs";
import type { JsonValue } from "@deepseek-ai/dsh-session";

export interface VaultDeps {
  /** Harness filesystem service (`ctx.fs`); absent in bare Node contexts (smoke tests). */
  fs?: FileSystem;
  logger?: { warn(message: string): void; info?(message: string): void };
  vaultPath: string;
  /** Glob patterns (directory basenames or `*` wildcards) excluded from listing/search. */
  excludePatterns?: string[];
}

export interface NoteSummary {
  /** Forward-slash path relative to the vault root, without extension. */
  name: string;
  /** Relative vault path including `.md` extension, forward slashes. */
  path: string;
}

export interface ParsedNote {
  path: string;
  title: string;
  frontmatter: JsonValue;
  body: string;
}

export interface VaultGraph {
  noteNames: string[];
  /** note name (target) → notes that link TO it. */
  backlinks: Map<string, string[]>;
  /** note name → names it links OUT to. */
  outgoing: Map<string, string[]>;
  /** tag → occurrence count. */
  tags: Map<string, number>;
  /** tag → notes carrying it. */
  tagToNotes: Map<string, string[]>;
  /** Notes with no incoming and no outgoing links. */
  orphans: string[];
}

export interface FolderNode {
  name: string;
  path: string;
  type: "folder" | "note";
  children: FolderNode[];
}

/**
 * Channel-A access layer over an Obsidian vault.
 *
 * Every filesystem touch goes through the harness filesystem service when one is
 * present (so first-party `write`/`edit` tool events stay coherent), and otherwise
 * falls back to plain Node `fs` so the core logic remains testable without a full
 * harness context.
 */
export class VaultService {
  readonly vaultPath: string;
  private readonly fs?: FileSystem;
  private readonly logger: NonNullable<VaultDeps["logger"]>;
  private readonly excludePatterns: string[];

  constructor(deps: VaultDeps) {
    if (!isAbsolute(deps.vaultPath)) {
      throw new Error(`obsidian-assistant: vaultPath must be absolute, got ${JSON.stringify(deps.vaultPath)}`);
    }
    this.vaultPath = deps.vaultPath;
    this.fs = deps.fs;
    this.logger = deps.logger ?? {
      warn: (m) => console.warn(m),
      info: (m) => console.info(m),
    };
    this.excludePatterns = deps.excludePatterns ?? [];
  }

  /** Resolve a vault-relative forward-slash path into an absolute native path, rejecting escapes. */
  resolveInVault(relPath: string): string {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized === "" || normalized === ".") return this.vaultPath;
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new Error(`obsidian-assistant: path escapes vault: ${JSON.stringify(relPath)}`);
    }
    const abs = join(this.vaultPath, ...normalized.split("/"));
    const rel = relative(this.vaultPath, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`obsidian-assistant: path escapes vault: ${JSON.stringify(relPath)}`);
    }
    return abs;
  }

  /** Whether a directory/file basename should be excluded. */
  private isExcluded(name: string, relDir: string): boolean {
    const full = relDir === "" ? name : `${relDir}/${name}`;
    return this.excludePatterns.some((p) => globMatch(p, name) || globMatch(p, full));
  }

  /** List all `.md` note summaries under the vault (channel A), honoring excludes. */
  async listNotes(signal?: AbortSignal): Promise<NoteSummary[]> {
    return await this.walkMarkdown("", signal);
  }

  private async walkMarkdown(prefix: string, signal?: AbortSignal): Promise<NoteSummary[]> {
    signal?.throwIfAborted();
    const out: NoteSummary[] = [];
    let entries: Array<{ name: string; type: string; target?: FsTarget }>;
    if (this.fs) {
      const target = await this.fs.resolve(prefix === "" ? this.vaultPath : this.resolveInVault(prefix));
      entries = await this.fs.listDir(target, signal);
    } else {
      const abs = this.resolveInVault(prefix === "" ? "." : prefix);
      entries = await readdir(abs, { withFileTypes: true }).then((ents) =>
        ents.map((e) => ({ name: e.name, type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other" })),
      );
    }
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (this.isExcluded(entry.name, prefix)) continue;
        const childPrefix = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        out.push(...(await this.walkMarkdown(childPrefix, signal)));
      } else if (entry.name.endsWith(".md")) {
        if (this.isExcluded(entry.name, prefix)) continue;
        const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        out.push({ name: rel.slice(0, -".md".length), path: rel });
      }
    }
    return out;
  }

  /** Read one note by vault-relative path (with or without `.md`), parsing frontmatter. */
  async readNote(relPath: string, signal?: AbortSignal): Promise<ParsedNote> {
    const rel = relPath.endsWith(".md") ? relPath : `${relPath}.md`;
    const abs = this.resolveInVault(rel);
    let raw: string;
    if (this.fs) {
      const target = await this.fs.resolve(abs);
      const info = await this.fs.stat(target, signal);
      if (info === undefined || info.type !== "file") {
        throw new Error(`obsidian-assistant: not a file: ${rel}`);
      }
      raw = await this.fs.readText(target, signal);
    } else {
      raw = await readFile(abs, "utf8");
    }
    return parseNote(rel, raw);
  }

  /**
   * Full-text search across all notes. Supports an optional `tag` filter and
   * returns matches with title, path, and a snippet.
   */
  async search(query: string, opts: { maxResults: number; tag?: string; signal?: AbortSignal }): Promise<Array<{ path: string; title: string; snippet: string; tags: string[] }>> {
    const q = query.trim().toLowerCase();
    const tag = opts.tag?.replace(/^#/, "").toLowerCase();
    if (!q && !tag) return [];
    const notes = await this.listNotes(opts.signal);
    const results: Array<{ path: string; title: string; snippet: string; tags: string[] }> = [];
    for (const note of notes) {
      if (results.length >= opts.maxResults) break;
      const parsed = await this.readNote(note.path, opts.signal);
      const noteTags = extractTags(parsed.frontmatter).concat(extractInlineTags(parsed.body)).map((t) => t.toLowerCase());
      if (tag && !noteTags.some((t) => t === tag || t.endsWith(`/${tag}`))) continue;
      if (q) {
        const hay = `${parsed.title}\n${parsed.body}`.toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) continue;
        const start = Math.max(0, idx - 40);
        const end = Math.min(hay.length, idx + q.length + 80);
        results.push({
          path: note.path,
          title: parsed.title,
          snippet: (start > 0 ? "…" : "") + hay.slice(start, end) + (end < hay.length ? "…" : ""),
          tags: [...new Set(noteTags)],
        });
      } else {
        // tag-only search
        results.push({ path: note.path, title: parsed.title, snippet: parsed.body.slice(0, 120), tags: [...new Set(noteTags)] });
      }
    }
    return results;
  }

  /**
   * Create a new note. `content` is the raw markdown body; frontmatter is
   * serialized to YAML and prepended when provided. Rejects overwriting an
   * existing note unless `overwrite` is true.
   */
  async createNote(opts: {
    relPath: string;
    content: string;
    frontmatter?: Record<string, JsonValue>;
    overwrite?: boolean;
    signal?: AbortSignal;
  }): Promise<{ path: string; operation: "create" | "update" }> {
    const rel = opts.relPath.endsWith(".md") ? opts.relPath : `${opts.relPath}.md`;
    const abs = this.resolveInVault(rel);
    const raw = opts.frontmatter ? stringifyFrontmatter(opts.frontmatter, opts.content) : opts.content;
    if (this.fs) {
      const target = await this.fs.resolve(abs);
      const info = await this.fs.stat(target, opts.signal);
      if (info !== undefined && !opts.overwrite) {
        throw new Error(`obsidian-assistant: note already exists: ${rel}`);
      }
      const outcome = await this.fs.writeText(target, raw, undefined, opts.signal);
      return { path: rel, operation: outcome.operation };
    }
    // Node fallback
    await mkdir(dirname(abs), { recursive: true });
    const { access } = await import("node:fs/promises");
    let existed = false;
    try {
      await access(abs);
      existed = true;
    } catch {}
    if (existed && !opts.overwrite) {
      throw new Error(`obsidian-assistant: note already exists: ${rel}`);
    }
    await writeFile(abs, raw, "utf8");
    return { path: rel, operation: existed ? "update" : "create" };
  }

  /**
   * Update an existing note by literal string replacement (safe, idempotent edit).
   * `oldString` must appear exactly once; set `replaceAll` to replace every match.
   * Appends to the end when `oldString` is omitted.
   */
  async updateNote(opts: {
    relPath: string;
    oldString?: string;
    newString: string;
    replaceAll?: boolean;
    signal?: AbortSignal;
  }): Promise<{ path: string }> {
    const rel = opts.relPath.endsWith(".md") ? opts.relPath : `${opts.relPath}.md`;
    const abs = this.resolveInVault(rel);
    if (this.fs) {
      const target = await this.fs.resolve(abs);
      if (opts.oldString === undefined) {
        const current = await this.fs.readText(target, opts.signal);
        await this.fs.writeText(target, current + opts.newString, { kind: "replaceIfVersion", version: (await this.fs.stat(target))!.version }, opts.signal);
      } else {
        await this.fs.editText(target, {
          oldString: opts.oldString,
          newString: opts.newString,
          replaceAll: opts.replaceAll ?? false,
        }, undefined, opts.signal);
      }
      return { path: rel };
    }
    // Node fallback (mirrors editText semantics exactly, so behavior is identical across channels)
    const current = await readFile(abs, "utf8");
    const next = applyLiteralEdit(current, opts.oldString, opts.newString, opts.replaceAll ?? false, rel);
    await writeFile(abs, next, "utf8");
    return { path: rel };
  }

  /**
   * Move/rename a note. Copies content to the destination, rewrites every
   * internal `[[oldName]]` wikilink to `[[newName]]` across the vault (matching
   * Obsidian's rename behavior), and reports whether the source file was
   * physically removed. The harness filesystem service exposes no delete/rename,
   * so under `fs` the source is left emptied (fails-safe, no data loss); under
   * Node fallback a true `rename` is performed.
   */
  async moveNote(opts: { from: string; to: string; overwrite?: boolean; signal?: AbortSignal }): Promise<{ from: string; to: string; sourceRemoved: boolean; updatedLinks: number }> {
    const fromRel = opts.from.endsWith(".md") ? opts.from : `${opts.from}.md`;
    const toRel = opts.to.endsWith(".md") ? opts.to : `${opts.to}.md`;
    const fromName = fromRel.slice(0, -".md".length);
    const toName = toRel.slice(0, -".md".length);
    const fromAbs = this.resolveInVault(fromRel);
    const toAbs = this.resolveInVault(toRel);

    if (this.fs) {
      const src = await this.fs.resolve(fromAbs);
      const dst = await this.fs.resolve(toAbs);
      const srcInfo = await this.fs.stat(src, opts.signal);
      if (srcInfo === undefined) throw new Error(`obsidian-assistant: source not found: ${fromRel}`);
      const dstInfo = await this.fs.stat(dst, opts.signal);
      if (dstInfo !== undefined && !opts.overwrite) {
        throw new Error(`obsidian-assistant: destination exists: ${toRel}`);
      }
      const content = await this.fs.readText(src, opts.signal);
      await this.fs.writeText(dst, content, undefined, opts.signal);
      // The fs service cannot delete; leave the source emptied so it stops showing up.
      await this.fs.writeText(src, "", undefined, opts.signal);
      const updatedLinks = await this.rewriteLinks(fromName, toName, opts.signal);
      return { from: fromRel, to: toRel, sourceRemoved: false, updatedLinks };
    }
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    const updatedLinks = await this.rewriteLinks(fromName, toName, opts.signal);
    return { from: fromRel, to: toRel, sourceRemoved: true, updatedLinks };
  }

  /** Rewrite every `[[fromName]]` wikilink across the vault to `[[toName]]`. */
  private async rewriteLinks(fromName: string, toName: string, signal?: AbortSignal): Promise<number> {
    if (fromName === toName) return 0;
    const notes = await this.listNotes(signal);
    let updated = 0;
    const linkRe = new RegExp(`\\[\\[${escapeRegExp(fromName)}(#[^\\]]+)?(\\|[^\\]]+)?\\]\\]`, "g");
    for (const note of notes) {
      const parsed = await this.readNote(note.path, signal);
      if (!linkRe.test(`${parsed.title}\n${parsed.body}`)) {
        linkRe.lastIndex = 0;
        continue;
      }
      linkRe.lastIndex = 0;
      const newBody = parsed.body.replace(linkRe, (whole) => whole.replace(fromName, toName));
      if (newBody !== parsed.body) {
        await this.updateNote({ relPath: note.path, oldString: parsed.body, newString: newBody, signal });
        updated++;
      }
    }
    return updated;
  }

  /** Build a wikilink/backlink/tag index across the whole vault. */
  async buildGraph(signal?: AbortSignal): Promise<VaultGraph> {
    const notes = await this.listNotes(signal);
    const backlinks = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    const tags = new Map<string, number>();
    const tagToNotes = new Map<string, string[]>();
    const noteNames = new Set(notes.map((n) => n.name));

    for (const note of notes) {
      const parsed = await this.readNote(note.path, signal);
      // Outgoing wikilinks [[Name]] / [[Name|alias]] / [[Name#heading]]
      const linkRe = /\[\[([^\]|#]+)(?:#[^\]]+)?(?:\|[^\]]+)?\]\]/g;
      let m: RegExpExecArray | null;
      const out = new Set<string>();
      while ((m = linkRe.exec(`${parsed.title}\n${parsed.body}`)) !== null) {
        const linked = m[1].trim();
        out.add(linked);
        const list = backlinks.get(linked) ?? [];
        if (!list.includes(note.name)) list.push(note.name);
        backlinks.set(linked, list);
      }
      outgoing.set(note.name, [...out]);
      // Tags: inline #tag and frontmatter `tags`
      const found = new Set<string>();
      for (const t of extractInlineTags(parsed.body)) found.add(t);
      for (const t of extractTags(parsed.frontmatter)) found.add(t);
      for (const t of found) {
        tags.set(t, (tags.get(t) ?? 0) + 1);
        const list = tagToNotes.get(t) ?? [];
        if (!list.includes(note.name)) list.push(note.name);
        tagToNotes.set(t, list);
      }
    }

    // Orphan = no incoming AND no outgoing links.
    const orphans: string[] = [];
    for (const name of noteNames) {
      const hasIn = (backlinks.get(name) ?? []).length > 0;
      const hasOut = (outgoing.get(name) ?? []).length > 0;
      if (!hasIn && !hasOut) orphans.push(name);
    }

    return { noteNames: [...noteNames], backlinks, outgoing, tags, tagToNotes, orphans };
  }

  /** Folder tree of the vault (directories + notes). */
  async folderTree(signal?: AbortSignal): Promise<FolderNode> {
    const notes = await this.listNotes(signal);
    const root: FolderNode = { name: "", path: "", type: "folder", children: [] };
    for (const note of notes) {
      insertPath(root, note.path.split("/"));
    }
    return root;
  }
}

function insertPath(node: FolderNode, parts: string[]): void {
  if (parts.length === 0) return;
  const [head, ...rest] = parts;
  const isNote = rest.length === 0 && head.endsWith(".md");
  const childPath = node.path === "" ? head : `${node.path}/${head}`;
  let child = node.children.find((c) => c.name === head);
  if (!child) {
    child = { name: head, path: childPath, type: isNote ? "note" : "folder", children: [] };
    node.children.push(child);
  }
  if (!isNote) insertPath(child, rest);
}

/** Apply a literal edit with exact-match / replaceAll semantics, shared across channels. */
function applyLiteralEdit(current: string, oldString: string | undefined, newString: string, replaceAll: boolean, rel: string): string {
  if (oldString === undefined) return current + newString;
  const idx = current.indexOf(oldString);
  if (idx < 0) {
    throw new Error(`obsidian-assistant: oldString not found in ${rel}`);
  }
  if (!replaceAll && current.indexOf(oldString, idx + oldString.length) >= 0) {
    throw new Error(`obsidian-assistant: oldString appears multiple times in ${rel}; set replaceAll or disambiguate`);
  }
  return replaceAll
    ? current.split(oldString).join(newString)
    : current.slice(0, idx) + newString + current.slice(idx + oldString.length);
}

/** Escape a string for use inside a RegExp literal. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Simple glob match supporting `*` wildcards; no `?` or character classes. */
function globMatch(pattern: string, value: string): boolean {
  const p = pattern.replace(/\\/g, "/");
  const v = value.replace(/\\/g, "/");
  // Directory prefix match: pattern "dir" excludes "dir" and everything under "dir/...".
  if (!p.includes("*") && (v === p || v.startsWith(p + "/"))) return true;
  const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`).test(v);
}

/** Serialize optional frontmatter + body into a full note. */
export function stringifyFrontmatter(frontmatter: Record<string, JsonValue>, body: string): string {
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}

/** Extract tags from parsed frontmatter (`tags:` array or string). */
function extractTags(fm: JsonValue): string[] {
  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) return [];
  const tags = (fm as Record<string, unknown>).tags;
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string").map((t) => String(t).replace(/^#/, ""));
  if (typeof tags === "string") return tags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
  return [];
}

/** Extract inline `#tag` occurrences from note body text. */
function extractInlineTags(body: string): string[] {
  const re = /(?:^|\s)#([A-Za-z0-9_\-/]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

/** Parse an Obsidian markdown note into frontmatter + body, using the `yaml` dependency. */
export function parseNote(path: string, raw: string): ParsedNote {
  const title = path.split("/").pop()!.replace(/\.md$/, "");
  return { path, title, frontmatter: extractFrontmatter(raw, parseYaml), body: stripFrontmatter(raw) };
}

function extractFrontmatter(raw: string, parse: (s: string) => unknown): JsonValue {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return null;
  let parsed: unknown;
  try {
    parsed = parse(raw.slice(3, end));
  } catch {
    return null;
  }
  return parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ? null
    : (parsed as JsonValue);
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return raw;
  const after = raw.indexOf("\n", end + 4);
  return after < 0 ? "" : raw.slice(after + 1);
}
