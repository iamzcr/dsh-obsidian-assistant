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

/** Left-pad a numeric string to a fixed width with '0'. */
function pad0(s: string, width: number): string {
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

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
export function isChapterPath(relPath: string): boolean {
  const stem = relPath.replace(/\.md$/i, "").split("/").pop() ?? "";
  return /第[0-9一二三四五六七八九十百零〇两]+\s*章/.test(stem) || /^(?:ch|第)?\s*\d+\s*[章话]/.test(stem);
}

/** Parse a Chinese numeral (up to 万). Returns NaN on failure. */
function parseChineseNum(s: string): number {
  const cleaned = s.replace(/〇/g, "零");
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let result = 0;
  let section = 0;
  let num = 0;
  for (const ch of cleaned) {
    if (ch in digits) {
      num = digits[ch];
    } else if (ch === "万") {
      section = (section + num) * units[ch];
      result += section;
      section = 0;
      num = 0;
    } else if (ch in units) {
      section += (num === 0 ? 1 : num) * units[ch];
      num = 0;
    } else {
      return NaN;
    }
  }
  result += section + num;
  return result === 0 && cleaned.length > 0 ? NaN : result;
}

/** Extract chapter number and title from a chapter filename stem. */
export function parseChapterStem(stem: string): { chapter: number; title: string } {
  const m = /第([0-9一二三四五六七八九十百零〇两]+)\s*章\s*[-—–·:：\s]*([\s\S]*)$/.exec(stem);
  if (m) {
    const numText = m[1];
    const chapter = /^\d+$/.test(numText) ? Number(numText) : parseChineseNum(numText);
    return { chapter, title: (m[2] ?? "").trim() };
  }
  const m2 = /^(?:第)?\s*(\d+)\s*[章话]?\s*[-—–·.:：\s]*([\s\S]*)$/.exec(stem);
  if (m2) return { chapter: Number(m2[1]), title: (m2[2] ?? "").trim() };
  return { chapter: NaN, title: stem };
}

/**
 * Clean a chapter's markdown body into plain text. Strips Obsidian/CommonMark
 * markers while preserving prose. When `includeCode` is false, fenced/inline
 * code is removed instead of kept verbatim.
 */
export function cleanToPlainText(markdown: string, includeCode: boolean): string {
  let text = markdown;
  text = text.replace(/\r\n/g, "\n");

  // Heading markers → drop the '#'.
  text = text.replace(/^ {0,3}#{1,6}\s+/gm, "");

  // Blockquote markers → drop the leading '>'.
  text = text.replace(/^ {0,3}>+[ \t]?/gm, "");

  // Thematic breaks (--- / *** / ___) alone on a line → discard.
  text = text.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, "");

  if (includeCode) {
    // Drop only the fencing lines, keep the code inside.
    text = text.replace(/^```[\w+-]*\s*$/gm, "");
  } else {
    // Drop fenced code blocks entirely.
    text = text.replace(/```[\w+-]*[ \t]*\n[\s\S]*?```[ \t]*\n?/gm, "");
  }

  // Inline code backticks (keep content when includeCode).
  text = text.replace(/`([^`\n]*)`/g, (_m, g: string) => (includeCode ? g : ""));

  // Bold / italic asterisks and underscores.
  text = text.replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  text = text.replace(/\*([^*\n]+)\*/g, "$1");
  text = text.replace(/___([^_\n]+)___/g, "$1");
  text = text.replace(/__([^_\n]+)__/g, "$1");
  text = text.replace(/_([^_\n]+)_/g, "$1");

  // Strikethrough.
  text = text.replace(/~~([^~\n]+)~~/g, "$1");

  // Images → drop, links → keep label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Wikilinks → keep display text (after | alias).
  text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]|]+))?\]\]/g, (_m, target, alias) => (alias ?? target).trim());
  // Embeds.
  text = text.replace(/!\[\[[^\]]+\]\]/g, "");

  // Footnotes.
  text = text.replace(/\[\^[^\]]*\](?::[^\n]*)?/g, "");
  text = text.replace(/^\s{0,3}\[\d+\]:\s.*$/gm, "");

  // HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // List markers → plain prose.
  text = text.replace(/^ {0,3}[-+*]\s+/gm, "");
  text = text.replace(/^ {0,3}\d+\.\s+/gm, "");

  // Collapse 3+ blank lines into one; trim edges.
  text = text.replace(/\n{3,}/g, "\n\n").replace(/^\s+/, "").replace(/\s+$/, "");
  return text;
}

/**
 * Render a chapter into the requested format body. TXT = chapter title line
 * followed by the cleaned plain text. Markdown = a single `#` heading plus the
 * original body.
 */
export function formatChapter(chapter: NovelChapter, format: "txt" | "markdown", includeCode: boolean): string {
  const heading = chapter.title || chapter.name;
  if (format === "txt") {
    const body = cleanToPlainText(chapter.body, includeCode);
    return `${heading}\n\n${body}`;
  }
  // Markdown: replace any leading heading with a single top-level title.
  const body = chapter.body.replace(/^(?: {0,3}#{1,6}\s+[\s\S]*?)\n/, "").replace(/\r\n/g, "\n").trimStart();
  return `# ${heading}\n\n${body}`;
}

/** Deterministic export folder: `<book>_YYYY-MM-DD_HHMMSS` (UTC). */
export function exportFolder(bookName: string, date?: Date): string {
  const d = date ?? new Date();
  const y = String(d.getUTCFullYear());
  const mo = pad0(String(d.getUTCMonth() + 1), 2);
  const da = pad0(String(d.getUTCDate()), 2);
  const h = pad0(String(d.getUTCHours()), 2);
  const mi = pad0(String(d.getUTCMinutes()), 2);
  const s = pad0(String(d.getUTCSeconds()), 2);
  return `${bookName}_${y}-${mo}-${da}_${h}${mi}${s}`;
}

/** Derive the book name from an explicit name or the scan folder. */
export function resolveBookName(bookName: string | undefined, folder: string | undefined): string {
  if (bookName && bookName.trim()) return bookName.trim();
  if (folder) {
    const segs = folder.split("/").filter(Boolean);
    return segs[segs.length - 1] || "小说";
  }
  return "小说";
}

/**
 * Normalize exclude specs into a predicate testable per chapter.
 * A numeric spec (or `第X章`) → chapter-number match; otherwise substring match
 * against the relative path or title. Empty array → accept all.
 */
export function compileExcludes(spec: string | string[] | undefined): (ch: Pick<NovelChapter, "path" | "title" | "chapter">) => boolean {
  const items = spec == null ? [] : Array.isArray(spec) ? spec : [spec];
  const numbers = new Set<number>();
  const substrings: string[] = [];
  for (const raw of items) {
    const item = String(raw).trim();
    if (!item) continue;
    const numM = /^第?([0-9一二三四五六七八九十百零〇两]+)章$/.exec(item);
    if (numM) {
      const n = /^\d+$/.test(numM[1]) ? Number(numM[1]) : parseChineseNum(numM[1]);
      if (Number.isFinite(n)) numbers.add(n);
      else substrings.push(item);
    } else if (/^\d+$/.test(item)) {
      numbers.add(Number(item));
    } else {
      substrings.push(item.toLowerCase());
    }
  }
  if (numbers.size === 0 && substrings.length === 0) {
    return () => false;
  }
  return (ch) => {
    if (Number.isFinite(ch.chapter) && numbers.has(ch.chapter)) return true;
    const low = `${ch.path} ${ch.title}`.toLowerCase();
    return substrings.some((s) => low.includes(s));
  };
}

/** Scan the vault for chapter notes, ordered by parsed chapter number. */
export async function listChapters(
  vault: VaultService,
  opts: ExportOptions,
  signal?: AbortSignal,
): Promise<NovelChapter[]> {
  const notes = await vault.listNotes(signal);
  const excluded = compileExcludes(opts.exclude);
  const chapters: NovelChapter[] = [];
  for (const note of notes) {
    if (opts.folder) {
      const dir = note.path.split("/").slice(0, -1).join("/");
      if (dir !== opts.folder && !dir.startsWith(opts.folder + "/")) continue;
    }
    if (!isChapterPath(note.path)) continue;
    const stem = note.path.split("/").pop()!.replace(/\.md$/i, "");
    const { chapter, title } = parseChapterStem(stem);
    if (
      opts.query &&
      !note.path.toLowerCase().includes(opts.query.toLowerCase()) &&
      !title.toLowerCase().includes(opts.query.toLowerCase())
    ) {
      continue;
    }
    if (excluded({ path: note.path, title: title || stem, chapter })) continue;
    const parsed = await vault.readNote(note.path, signal);
    chapters.push({
      path: note.path,
      name: stem,
      chapter,
      title: title || stem,
      frontmatter: (parsed.frontmatter as Record<string, unknown> | null) ?? null,
      body: parsed.body,
    });
  }
  chapters.sort((a, b) => {
    const na = Number.isFinite(a.chapter) ? a.chapter : Number.MAX_SAFE_INTEGER;
    const nb = Number.isFinite(b.chapter) ? b.chapter : Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    return a.path.localeCompare(b.path, "zh-Hans-CN");
  });
  return chapters;
}
