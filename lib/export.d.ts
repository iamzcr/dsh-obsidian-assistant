/**
 * Novel/publishing export helper (channel A): turn vault chapter notes into
 * clean, paste-ready manuscripts.
 *
 * Each chapter note is identified by its filename (`第X章-标题`), ordered by
 * the parsed chapter number (Chinese numerals or arabic), then cleaned into a
 * plain-text TXT and/or Markdown rendering suitable for copy-paste into a
 * serialized-novel platform backend. The VaultService does the file scanning
 * and reading; this module owns chapter identification, ordering, cleaning and
 * formatting.
 */
import type { VaultService } from "./vault.js";
/** One identified chapter note, in source order. */
export interface NovelChapter {
    /** Vault-relative path including `.md`. */
    path: string;
    /** Filename stem: `<第X章>-<标题>` or the whole stem when unnumbered. */
    name: string;
    /** Parsed chapter number (NaN when the filename carries none). */
    chapter: number;
    /** Trailing title portion after the chapter marker. */
    title: string;
    /** Parsed frontmatter object when present. */
    frontmatter: Record<string, unknown> | null;
    /** Raw markdown body (frontmatter stripped). */
    body: string;
}
export type ExportFormat = "txt" | "markdown" | "both";
export interface ExportOptions {
    /** Scan only inside this vault-relative directory (e.g. `小说`). */
    folder?: string;
    /** Only chapters whose title/path contains this substring. */
    query?: string;
    /**
     * Chapter(s) to exclude before exporting. Accepts a single item or an array.
     * An entry that is a bare number or `第X章`-shaped matches by chapter number;
     * any other entry matches by path or title substring (case-insensitive).
     * Hit items (and every duplicate of that chapter) are skipped.
     */
    exclude?: string | string[];
    /** Keep code blocks/inline-code verbatim. Default true. */
    includeCode?: boolean;
}
/**
 * Whether a note looks like a chapter: filename matches `第X章` (Chinese or
 * arabic numerals) or a bare-number chapter (`12. 标题`).
 */
export declare function isChapterPath(relPath: string): boolean;
/** Extract chapter number and title from a chapter filename stem. */
export declare function parseChapterStem(stem: string): {
    chapter: number;
    title: string;
};
/**
 * Clean a chapter's markdown body into plain text. Strips Obsidian/CommonMark
 * markers while preserving prose. When `includeCode` is false, fenced/inline
 * code is removed instead of kept verbatim.
 */
export declare function cleanToPlainText(markdown: string, includeCode: boolean): string;
/**
 * Render a chapter into the requested format body. TXT = chapter title line
 * followed by the cleaned plain text. Markdown = a single `#` heading plus the
 * original body.
 */
export declare function formatChapter(chapter: NovelChapter, format: "txt" | "markdown", includeCode: boolean): string;
/** Deterministic export folder: `<book>_YYYY-MM-DD_HHMMSS` (UTC). */
export declare function exportFolder(bookName: string, date?: Date): string;
/** Derive the book name from an explicit name or the scan folder. */
export declare function resolveBookName(bookName: string | undefined, folder: string | undefined): string;
/**
 * Normalize exclude specs into a predicate testable per chapter.
 * A numeric spec (or `第X章`) → chapter-number match; otherwise substring match
 * against the relative path or title. Empty array → accept all.
 */
export declare function compileExcludes(spec: string | string[] | undefined): (ch: Pick<NovelChapter, "path" | "title" | "chapter">) => boolean;
/** Scan the vault for chapter notes, ordered by parsed chapter number. */
export declare function listChapters(vault: VaultService, opts: ExportOptions, signal?: AbortSignal): Promise<NovelChapter[]>;
