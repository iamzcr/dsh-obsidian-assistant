import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import * as plugin from "../lib/index.js";
import { VaultService } from "../lib/vault.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureVault = join(here, "..", "fixtures", "vault");

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

// ── Minimal harness FileSystem backend mapping to Node fs ──────────────
function makeNodeFsBackend() {
  const pathOf = (target) => (typeof target === "string" ? target : target.targetKey);
  return {
    async resolve(path) {
      return { targetKey: path, displayPath: path };
    },
    async listDir(target, signal) {
      const dir = pathOf(target);
      const ents = await readdir(dir, { withFileTypes: true });
      return ents.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
        target: { targetKey: join(dir, e.name), displayPath: join(dir, e.name) },
      }));
    },
    async readText(target) { return await readFile(pathOf(target), "utf8"); },
    async stat(target) {
      try {
        const s = await stat(pathOf(target));
        const type = s.isDirectory() ? "directory" : s.isFile() ? "file" : "other";
        return { version: `v${s.mtimeMs}`, type, size: s.size };
      } catch { return undefined; }
    },
    async writeText(target, content) {
      const p = pathOf(target);
      await mkdir(dirname(p), { recursive: true });
      let existed = false;
      try { await stat(p); existed = true; } catch {}
      const before = existed ? await readFile(p, "utf8") : null;
      await writeFile(p, content, "utf8");
      return { operation: existed ? "update" : "create", version: "v", before, after: content };
    },
    async editText(target, edit) {
      const p = pathOf(target);
      const cur = await readFile(p, "utf8");
      const idx = cur.indexOf(edit.oldString);
      if (idx < 0) { const e = new Error("FS_EDIT_NOT_FOUND"); throw e; }
      const next = edit.replaceAll
        ? cur.split(edit.oldString).join(edit.newString)
        : cur.slice(0, idx) + edit.newString + cur.slice(idx + edit.oldString.length);
      await writeFile(p, next, "utf8");
      return { version: "v", before: cur, after: next };
    },
  };
}

// ── Minimal ctx with tools collector + fs service ──────────────────────
function makeCtx(fs) {
  const registered = [];
  const tools = {
    register(def) {
      registered.push(def);
      return () => {};
    },
    get(name) { return registered.find((d) => d.name === name); },
  };
  const ctx = {
    fs,
    tools,
    logger: { warn: () => {}, info: () => {} },
    _registered: registered,
  };
  return ctx;
}

const exec = { signal: new AbortController().signal };

// ── Test: register all tools + exercise read/search/write/graph/batch ──
async function main() {
  // Use a temp copy of the fixture vault so write tests don't mutate fixtures.
  const tmp = await mkdtemp(join(tmpdir(), "obsidian-test-"));
  const vaultPath = join(tmp, "vault");
  await copyDir(fixtureVault, vaultPath);

  const pluginName = plugin.name;
  check("exports name = dsh-obsidian-assistant", pluginName === "dsh-obsidian-assistant");

  const fs = makeNodeFsBackend();
  const ctx = makeCtx(fs);
  plugin.apply(ctx, { vaultPath, apiUrl: "http://127.0.0.1:27124", apiToken: "", enableRestApi: false, excludePatterns: [], maxResults: 50 });

  const names = ctx._registered.map((d) => d.name).sort();
  check("registers 12 tools", names.length === 12, names.join(","));
  check("has obsidian_search", ctx.tools.get("obsidian_search") !== undefined);
  check("has obsidian_read_note", ctx.tools.get("obsidian_read_note") !== undefined);
  check("has obsidian_create_note", ctx.tools.get("obsidian_create_note") !== undefined);
  check("has obsidian_update_note", ctx.tools.get("obsidian_update_note") !== undefined);
  check("has obsidian_list_structure", ctx.tools.get("obsidian_list_structure") !== undefined);
  check("has obsidian_backlinks", ctx.tools.get("obsidian_backlinks") !== undefined);
  check("has obsidian_batch", ctx.tools.get("obsidian_batch") !== undefined);
  check("has obsidian_export_novel", ctx.tools.get("obsidian_export_novel") !== undefined);
  check("has obsidian_rest_query", ctx.tools.get("obsidian_rest_query") !== undefined);
  check("has obsidian_rest_search", ctx.tools.get("obsidian_rest_search") !== undefined);
  check("has obsidian_list_commands", ctx.tools.get("obsidian_list_commands") !== undefined);
  check("has obsidian_run_command", ctx.tools.get("obsidian_run_command") !== undefined);

  // search
  const searchRes = await ctx.tools.get("obsidian_search").execute({ query: "harness" }, exec);
  check("search returns matches", searchRes.matches.length >= 1, JSON.stringify(searchRes.matches.map((m) => m.path)));

  // tag-only search (Welcome.md has tags: [project, ideas])
  const tagSearch = await ctx.tools.get("obsidian_search").execute({ tag: "ideas" }, exec);
  check("search filters by tag", tagSearch.matches.some((m) => m.title === "Welcome"), JSON.stringify(tagSearch.matches.map((m) => m.title)));

  // create
  const createRes = await ctx.tools.get("obsidian_create_note").execute({ path: "New Note", content: "Hello world", frontmatter: { tags: ["test"] } }, exec);
  check("create note returns operation", createRes.path === "New Note.md" && createRes.operation === "create", JSON.stringify(createRes));
  const created = await readFile(join(vaultPath, "New Note.md"), "utf8");
  check("create note writes frontmatter", created.startsWith("---") && created.includes("tags:"), created.split("\n")[0]);

  // create a referrer note that links to [[New Note]] to verify link rewriting on move
  await ctx.tools.get("obsidian_create_note").execute({ path: "Reference", content: "See [[New Note]] for details." }, exec);

  // update (append)
  const updRes = await ctx.tools.get("obsidian_update_note").execute({ path: "New Note", newString: "\nappended" }, exec);
  check("update note appends", updRes.path === "New Note.md");
  const updated = await readFile(join(vaultPath, "New Note.md"), "utf8");
  check("update note content appended", updated.includes("appended"));

  // update (literal replace)
  await ctx.tools.get("obsidian_update_note").execute({ path: "New Note", oldString: "Hello world", newString: "Hi there" }, exec);
  const replaced = await readFile(join(vaultPath, "New Note.md"), "utf8");
  check("update note literal replace", replaced.includes("Hi there") && !replaced.includes("Hello world"));

  // backlinks (Welcome.md links to Second Note; Second Note links back)
  const blRes = await ctx.tools.get("obsidian_backlinks").execute({}, exec);
  check("backlinks resolves Welcome", (blRes.backlinks["Welcome"] ?? []).includes("Second Note"), JSON.stringify(blRes.backlinks));

  // list structure
  const structRes = await ctx.tools.get("obsidian_list_structure").execute({}, exec);
  check("structure counts notes", structRes.totalNotes >= 4, String(structRes.totalNotes));

  // batch move (should rewrite [[New Note]] -> [[Moved Note]] in Reference.md)
  const batchRes = await ctx.tools.get("obsidian_batch").execute({ operations: [{ kind: "move", from: "New Note", to: "Moved Note" }] }, exec);
  check("batch move ok", batchRes.results[0]?.ok === true, JSON.stringify(batchRes.results));
  check("batch move reports updatedLinks", batchRes.results[0]?.updatedLinks >= 1, JSON.stringify(batchRes.results[0]));
  const movedExists = await exists(join(vaultPath, "Moved Note.md"));
  check("batch moved file exists", movedExists);
  const refContent = await readFile(join(vaultPath, "Reference.md"), "utf8");
  check("move rewrites internal wikilink", refContent.includes("[[Moved Note]]") && !refContent.includes("[[New Note]]"), refContent);

  // ── obsidian_export_novel: fixture 第X章 notes → txt + md manuscripts ──
  await ctx.tools.get("obsidian_create_note").execute({
    path: "小说/第一章-测试",
    content: "# 第一章 测试\n\n这是**第一**章正文。\n\n```js\nconst a = 1;\n```\n",
    frontmatter: { tags: ["小说"], 章节: "第一章" },
  }, exec);
  await ctx.tools.get("obsidian_create_note").execute({
    path: "小说/第二章-再来",
    frontmatter: { tags: ["小说"], 章节: "第二章" },
    content: "# 第二章 再来\n\n-- 这是```code```第二章 ```inline``` 正文。\n",
  }, exec);
  const exportRes = await ctx.tools.get("obsidian_export_novel").execute({ format: "both", folder: "小说" }, exec);
  check("export counts 2 chapters", exportRes.totalChapters === 2, JSON.stringify(exportRes.written));
  check("export writes both formats", exportRes.written.some((w) => w.endsWith(".txt")) && exportRes.written.some((w) => w.endsWith(".md")), exportRes.written.join(","));
  const outDirAbs = join(vaultPath, "导出");
  const entries = await readdir(join(vaultPath, "导出"), { withFileTypes: true });
  const stampDir = entries.find((e) => e.isDirectory())?.name;
  check("export creates timestamped dir", !!stampDir, stampDir ?? "");
  const actualDir = join(outDirAbs, stampDir);
  const files = await readdir(actualDir);
  check("export writes 4 files (2ch x2fmt)", files.length === 4, files.join(","));
  const txt = await readFile(join(actualDir, files.find((f) => f.includes("第一章") && f.endsWith(".txt"))), "utf8");
  check("txt keeps code when includeCode=true", txt.includes("const a = 1"), txt);
  check("txt strips bold markers", !txt.includes("**"), txt);
  const noCode = await ctx.tools.get("obsidian_export_novel").execute({ format: "txt", folder: "小说", includeCode: false }, exec);
  check("includeCode=false still runs", noCode.totalChapters === 2, String(noCode.totalChapters));

  // Obsidian/CommonMark stripping + exclude
  const exclRes = await ctx.tools.get("obsidian_export_novel").execute({ format: "txt", folder: "小说", exclude: ["2", "再来"] }, exec);
  check("exclude skips matched chapters", exclRes.totalChapters === 1 && exclRes.written.every((w) => w.includes("第一章")), exclRes.written.join(","));

  // exclude patterns: build a .trash note and a fresh service with excludePatterns
  await mkdir(join(vaultPath, ".trash"), { recursive: true });
  await writeFile(join(vaultPath, ".trash", "ignored.md"), "# ignored\n");
  const excludedVault = new VaultService({ vaultPath, excludePatterns: [".trash"] });
  const excludedNotes = await excludedVault.listNotes();
  check("excludePatterns hides .trash", !excludedNotes.some((n) => n.path.startsWith(".trash/")), excludedNotes.map((n) => n.path).join(","));

  // vault path traversal guard
  let guarded = false;
  try {
    new VaultService({ vaultPath }).resolveInVault("../../etc/passwd");
  } catch { guarded = true; }
  check("resolveInVault guards traversal", guarded);

  await rm(tmp, { recursive: true, force: true });

  console.log(failures === 0 ? "\nALL INTEGRATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const ents = await readdir(src, { withFileTypes: true });
  for (const e of ents) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await writeFile(d, await readFile(s));
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

main().catch((e) => {
  console.error("integration test crashed:", e);
  process.exit(1);
});
