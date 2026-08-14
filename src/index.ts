import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
import type { JsonValue } from "@deepseek-ai/dsh-session";
import { VaultService } from "./vault.js";
import { ObsidianApiClient } from "./rest.js";

export const name = "dsh-obsidian-assistant";
export const inject = ["tools", "fs"];

/**
 * Schemastery config schema. `vaultPath` is optional here so the published
 * bundle patch can omit it and the plugin still loads; `apply` then fails loud
 * with an actionable message when it is missing or not absolute.
 */
export const Config = z.object({
  vaultPath: z.string(),
  apiUrl: z.string().default("https://127.0.0.1:27124"),
  apiToken: z.string().default(""),
  enableRestApi: z.boolean().default(true),
  excludePatterns: z.array(z.string()).default([".obsidian", ".trash"]),
  maxResults: z.number().default(50),
});

/** Resolved config (after schemastery defaults are applied). */
export type ResolvedConfig = Schemastery.TypeT<typeof Config>;

/**
 * Register the obsidian_* toolset on `ctx.tools`, backed by `VaultService`
 * (direct file access) with an optional `ObsidianApiClient` (Local REST API).
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  const vaultPath = config.vaultPath;
  if (!vaultPath) {
    throw new Error(
      "dsh-obsidian-assistant: vaultPath is required. Set it in your profile's cordis.patch.yml, e.g.:\n" +
        "  - id: dsh-obsidian-assistant\n" +
        "    config:\n" +
        '      vaultPath: "D:/my-notes"',
    );
  }

  const vault = new VaultService({
    fs: ctx.fs,
    logger: (ctx as unknown as { logger?: { warn(m: string): void; info?(m: string): void } }).logger,
    vaultPath,
    excludePatterns: config.excludePatterns,
  });

  const rest = new ObsidianApiClient({
    baseUrl: config.apiUrl,
    token: config.apiToken,
    enabled: config.enableRestApi,
  });
  // Probe in the background; failure is silent (channel A stays authoritative).
  void rest.probe().catch(() => {});

  // ── 1. obsidian_search ────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_search",
    description: `Search a local Obsidian vault for notes whose title or body contains a query string, optionally filtered by a tag. Returns up to ${config.maxResults} matches with their vault-relative path, title, tags, and a text snippet. Prefer this over raw file tools when the user asks to find notes by topic or keyword in their Obsidian knowledge base.`,
    parameters: {
      query: { type: "string", description: "Case-insensitive substring to match against note titles and bodies. Omit to search by tag only." },
      tag: { type: "string", description: "Optional tag filter (e.g. \"ideas\" or \"project/ideas\")." },
      maxResults: { type: "integer", description: `Optional cap on matches; defaults to ${config.maxResults}.` },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string", required: true },
                title: { type: "string", required: true },
                snippet: { type: "string", required: true },
                tags: { type: "array", required: true, items: { type: "string" } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.matches.length === 0
          ? "No matching notes found."
          : value.matches.map((m) => `- ${m.title} (${m.path})${m.tags.length ? " [" + m.tags.join(", ") + "]" : ""}\n  ${m.snippet}`).join("\n"),
      }],
    },
    execute(args, exec) {
      return vault.search(args.query ?? "", { maxResults: args.maxResults ?? config.maxResults, tag: args.tag, signal: exec.signal })
        .then((matches) => ({ matches }));
    },
    presentCall: (args) => ({ card: "generic", title: "Search vault", kind: "search", rawInput: args.query ?? args.tag }),
  }));

  // ── 2. obsidian_read_note ─────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_read_note",
    description: `Read a single note from the local Obsidian vault by vault-relative path (with or without the ".md" extension). Returns the note title, parsed YAML frontmatter, and the markdown body. Use this to inspect a note's contents, tags, aliases, and metadata before editing.`,
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative note path, with or without the \".md\" extension." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          title: { type: "string", required: true },
          frontmatter: { type: "json" },
          body: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `# ${value.title}\nfrontmatter: ${value.frontmatter != null ? JSON.stringify(value.frontmatter) : "(none)"}\n\n${value.body}`,
      }],
    },
    execute(args, exec) { return vault.readNote(args.path, exec.signal); },
    presentCall: (args) => ({ card: "generic", title: "Read note", kind: "read", rawInput: args.path }),
  }));

  // ── 3. obsidian_create_note ───────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_create_note",
    description: `Create a new note in the local Obsidian vault at the given vault-relative path. Optionally provide YAML frontmatter (tags, aliases, etc.) and the raw markdown body. Refuses to overwrite an existing note unless overwrite is true.`,
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative path for the new note (with or without \".md\")." },
      content: { type: "string", required: true, description: "Raw markdown body of the note (frontmatter is added automatically when supplied)." },
      frontmatter: { type: "json", description: "Optional frontmatter object (e.g. {\"tags\":[\"ideas\"]}) pre-written as YAML." },
      overwrite: { type: "boolean", description: "Allow replacing an existing note. Defaults to false." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          operation: { type: "string", required: true, enum: ["create", "update"] },
        },
      },
      render: (_args, value) => [{ type: "text", text: `${value.operation === "create" ? "Created" : "Replaced"} note: ${value.path}` }],
    },
    execute(args, exec) {
      const fm = args.frontmatter != null && typeof args.frontmatter === "object" && !Array.isArray(args.frontmatter)
        ? args.frontmatter as Record<string, JsonValue>
        : undefined;
      return vault.createNote({
        relPath: args.path,
        content: args.content,
        frontmatter: fm,
        overwrite: args.overwrite,
        signal: exec.signal,
      });
    },
    presentCall: (args) => ({ card: "diff", title: `Create note ${args.path}`, diffs: [{ path: args.path, oldText: null, newText: args.content }] }),
  }));

  // ── 4. obsidian_update_note ───────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_update_note",
    description: `Edit an existing note in the local Obsidian vault by literal string replacement. Provide oldString (must match exactly once) and newString; omit oldString to append newString to the end. Set replaceAll to replace every occurrence.`,
    parameters: {
      path: { type: "string", required: true, description: "Vault-relative note path." },
      oldString: { type: "string", description: "Literal text to replace; omit to append." },
      newString: { type: "string", required: true, description: "Replacement text (or text to append when oldString is omitted)." },
      replaceAll: { type: "boolean", description: "Replace every occurrence of oldString. Defaults to false." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { path: { type: "string", required: true } },
      },
      render: (_args, value) => [{ type: "text", text: `Updated note: ${value.path}` }],
    },
    execute(args, exec) {
      return vault.updateNote({
        relPath: args.path,
        oldString: args.oldString,
        newString: args.newString,
        replaceAll: args.replaceAll,
        signal: exec.signal,
      });
    },
    presentCall: (args) => ({
      card: "diff",
      title: `Edit note ${args.path}`,
      diffs: [{ path: args.path, oldText: args.oldString ?? null, newText: args.newString }],
    }),
  }));

  // ── 5. obsidian_list_structure ────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_list_structure",
    description: `List the structure of the local Obsidian vault: the folder/note tree, tag statistics, and orphan notes (notes with no outgoing wikilinks). Useful for orienting before navigating or reorganizing the vault.`,
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          tree: { type: "json", required: true },
          tags: { type: "json", required: true },
          orphans: { type: "array", required: true, items: { type: "string" } },
          totalNotes: { type: "integer", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Vault has ${value.totalNotes} notes; ${value.orphans.length} orphan(s).\nTags: ${JSON.stringify(value.tags)}`,
      }],
    },
    async execute(_args, exec) {
      const tree = await vault.folderTree(exec.signal);
      const graph = await vault.buildGraph(exec.signal);
      return {
        tree: tree as unknown as JsonValue,
        tags: Object.fromEntries([...graph.tags.entries()].sort((a, b) => b[1] - a[1])) as JsonValue,
        orphans: graph.orphans,
        totalNotes: graph.noteNames.length,
      };
    },
    presentCall: () => ({ card: "generic", title: "List vault structure", kind: "search" }),
  }));

  // ── 6. obsidian_backlinks ─────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_backlinks",
    description: `Query the backlink (bidirectional link) graph of the local Obsidian vault. Returns which notes link to each note name, plus tag-to-note membership. Pass a specific note name to see only its incoming links.`,
    parameters: {
      note: { type: "string", description: "Optional note name (without extension) to filter backlinks to." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          backlinks: { type: "json", required: true },
          tagToNotes: { type: "json", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: `Backlinks:\n${JSON.stringify(value.backlinks, null, 2)}`,
      }],
    },
    async execute(args, exec) {
      const graph = await vault.buildGraph(exec.signal);
      let backlinks = Object.fromEntries([...graph.backlinks.entries()].sort());
      if (args.note) {
        backlinks = { [args.note]: graph.backlinks.get(args.note) ?? [] };
      }
      return {
        backlinks,
        tagToNotes: Object.fromEntries([...graph.tagToNotes.entries()].sort()),
      };
    },
    presentCall: (args) => ({ card: "generic", title: "Query backlinks", kind: "search", rawInput: args.note ?? "(all)" }),
  }));

  // ── 7. obsidian_batch ─────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_batch",
    description: `Perform a batch operation across the local Obsidian vault. Currently supports "move" (rename/move a single note). Each operation reports its result; a failed operation does not abort the batch.`,
    parameters: {
      operations: {
        type: "array",
        required: true,
        description: "List of operations to run.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", required: true, enum: ["move"] },
            from: { type: "string", required: true },
            to: { type: "string", required: true },
            overwrite: { type: "boolean" },
          },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          results: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                ok: { type: "boolean", required: true },
                from: { type: "string", required: true },
                to: { type: "string", required: true },
                sourceRemoved: { type: "boolean" },
                updatedLinks: { type: "integer" },
                error: { type: "string" },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.results.map((r) => `${r.ok ? "OK" : "FAIL"}  ${r.from} -> ${r.to}${r.updatedLinks ? `  [${r.updatedLinks} links updated]` : ""}${r.error ? "  " + r.error : ""}`).join("\n"),
      }],
    },
    async execute(args, exec) {
      const results = [];
      for (const op of args.operations) {
        try {
          if (op.kind === "move") {
            const r = await vault.moveNote({ from: op.from, to: op.to, overwrite: op.overwrite, signal: exec.signal });
            results.push({ ok: true, from: r.from, to: r.to, sourceRemoved: r.sourceRemoved, updatedLinks: r.updatedLinks });
          } else {
            results.push({ ok: false, from: "", to: "", error: `unknown operation kind: ${(op as { kind: string }).kind}` });
          }
        } catch (error) {
          results.push({ ok: false, from: op.from, to: op.to, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { results };
    },
    presentCall: (args) => ({ card: "generic", title: `Batch (${args.operations.length} ops)`, kind: "other", rawInput: args.operations.length }),
  }));

  // ── 8. obsidian_rest_query ────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_rest_query",
    description: `Invoke an advanced query through the Obsidian "Local REST API" community plugin (channel B). Only available when Obsidian is running with that plugin installed; otherwise the call fails with a clear message and the file-based tools remain available.`,
    parameters: {
      path: { type: "string", required: true, description: "REST API path relative to the base URL (e.g. \"search/simple/\" or \"vault/\")." },
      method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], description: "HTTP method; defaults to GET." },
      body: { type: "json", description: "Optional JSON request body for POST/PUT." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "integer", required: true },
          data: { type: "json", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: `REST ${value.status}:\n${JSON.stringify(value.data, null, 2)}` }],
    },
    async execute(args, exec) {
      const r = await rest.request({
        method: (args.method as "GET" | "POST" | "PUT" | "DELETE") ?? "GET",
        path: args.path,
        body: args.body,
        signal: exec.signal,
      });
      return { status: r.status, data: r.data as JsonValue };
    },
    presentCall: (args) => ({ card: "generic", title: "REST query", kind: "fetch", rawInput: args.path }),
  }));

  // ── 9. obsidian_rest_search ───────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_rest_search",
    description: `Full-text search through Obsidian's own index via the Local REST API plugin (channel B). Much faster than file-scanning on large vaults, and supports Obsidian search syntax. Available only when Obsidian is running with the plugin installed.`,
    parameters: {
      query: { type: "string", required: true, description: "Search query (Obsidian search syntax supported)." },
      contextLength: { type: "integer", description: "Context characters around each match; defaults to 100." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          matches: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                filename: { type: "string", required: true },
                score: { type: "number" },
                snippets: { type: "array", required: true, items: { type: "string" } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.matches.length === 0
          ? "No matches."
          : value.matches.map((m) => `- ${m.filename}${m.score != null ? ` (score ${m.score})` : ""}\n  ${m.snippets.join(" | ")}`).join("\n"),
      }],
    },
    async execute(args, exec) {
      const raw = await rest.search(args.query, { contextLength: args.contextLength, signal: exec.signal });
      const matches = raw.map((m) => ({
        filename: m.filename,
        score: m.score,
        snippets: (m.matches ?? []).map((x) => x.snippet ?? "").filter(Boolean),
      }));
      return { matches };
    },
    presentCall: (args) => ({ card: "generic", title: "REST search", kind: "search", rawInput: args.query }),
  }));

  // ── 10. obsidian_list_commands ────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_list_commands",
    description: `List Obsidian commands (id + name) available via the Local REST API plugin. Use this to discover command ids, then call obsidian_run_command to trigger one (e.g. Dataview re-render, Templater, QuickAdd, etc.).`,
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          commands: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: value.commands.map((c) => `${c.id}  →  ${c.name}`).join("\n"),
      }],
    },
    async execute(_args, exec) {
      const commands = await rest.listCommands(exec.signal);
      return { commands };
    },
    presentCall: () => ({ card: "generic", title: "List Obsidian commands", kind: "other" }),
  }));

  // ── 11. obsidian_run_command ──────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: "obsidian_run_command",
    description: `Trigger an Obsidian command by its id via the Local REST API plugin (channel B). Use obsidian_list_commands to discover ids first. This is how to run workflows like Templater, QuickAdd, or Dataview re-render (Dataview has no native REST endpoint — trigger its command instead).`,
    parameters: {
      commandId: { type: "string", required: true, description: "Obsidian command id (see obsidian_list_commands)." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          executed: { type: "boolean", required: true },
          commandId: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: `Ran command: ${value.commandId}` }],
    },
    async execute(args, exec) {
      await rest.runCommand(args.commandId, exec.signal);
      return { executed: true, commandId: args.commandId };
    },
    presentCall: (args) => ({ card: "generic", title: `Run command ${args.commandId}`, kind: "execute", rawInput: args.commandId }),
  }));
}
