import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { JsonValue } from "@deepseek-ai/dsh-session";
export interface VaultDeps {
    /** Harness filesystem service (`ctx.fs`); absent in bare Node contexts (smoke tests). */
    fs?: FileSystem;
    logger?: {
        warn(message: string): void;
        info?(message: string): void;
    };
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
export declare class VaultService {
    readonly vaultPath: string;
    private readonly fs?;
    private readonly logger;
    private readonly excludePatterns;
    constructor(deps: VaultDeps);
    /** Resolve a vault-relative forward-slash path into an absolute native path, rejecting escapes. */
    resolveInVault(relPath: string): string;
    /** Whether a directory/file basename should be excluded. */
    private isExcluded;
    /** List all `.md` note summaries under the vault (channel A), honoring excludes. */
    listNotes(signal?: AbortSignal): Promise<NoteSummary[]>;
    private walkMarkdown;
    /** Read one note by vault-relative path (with or without `.md`), parsing frontmatter. */
    readNote(relPath: string, signal?: AbortSignal): Promise<ParsedNote>;
    /**
     * Full-text search across all notes. Supports an optional `tag` filter and
     * returns matches with title, path, and a snippet.
     */
    search(query: string, opts: {
        maxResults: number;
        tag?: string;
        signal?: AbortSignal;
    }): Promise<Array<{
        path: string;
        title: string;
        snippet: string;
        tags: string[];
    }>>;
    /**
     * Create a new note. `content` is the raw markdown body; frontmatter is
     * serialized to YAML and prepended when provided. Rejects overwriting an
     * existing note unless `overwrite` is true.
     */
    createNote(opts: {
        relPath: string;
        content: string;
        frontmatter?: Record<string, JsonValue>;
        overwrite?: boolean;
        signal?: AbortSignal;
    }): Promise<{
        path: string;
        operation: "create" | "update";
    }>;
    /**
     * Update an existing note by literal string replacement (safe, idempotent edit).
     * `oldString` must appear exactly once; set `replaceAll` to replace every match.
     * Appends to the end when `oldString` is omitted.
     */
    updateNote(opts: {
        relPath: string;
        oldString?: string;
        newString: string;
        replaceAll?: boolean;
        signal?: AbortSignal;
    }): Promise<{
        path: string;
    }>;
    /**
     * Move/rename a note. Copies content to the destination, rewrites every
     * internal `[[oldName]]` wikilink to `[[newName]]` across the vault (matching
     * Obsidian's rename behavior), and reports whether the source file was
     * physically removed. The harness filesystem service exposes no delete/rename,
     * so under `fs` the source is left emptied (fails-safe, no data loss); under
     * Node fallback a true `rename` is performed.
     */
    moveNote(opts: {
        from: string;
        to: string;
        overwrite?: boolean;
        signal?: AbortSignal;
    }): Promise<{
        from: string;
        to: string;
        sourceRemoved: boolean;
        updatedLinks: number;
    }>;
    /** Rewrite every `[[fromName]]` wikilink across the vault to `[[toName]]`. */
    private rewriteLinks;
    /** Build a wikilink/backlink/tag index across the whole vault. */
    buildGraph(signal?: AbortSignal): Promise<VaultGraph>;
    /** Folder tree of the vault (directories + notes). */
    folderTree(signal?: AbortSignal): Promise<FolderNode>;
}
/** Serialize optional frontmatter + body into a full note. */
export declare function stringifyFrontmatter(frontmatter: Record<string, JsonValue>, body: string): string;
/** Parse an Obsidian markdown note into frontmatter + body, using the `yaml` dependency. */
export declare function parseNote(path: string, raw: string): ParsedNote;
