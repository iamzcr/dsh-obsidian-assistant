import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VaultService } from "../lib/vault.js";

const here = dirname(fileURLToPath(import.meta.url));
const vaultPath = join(here, "..", "fixtures", "vault");

const vault = new VaultService({ vaultPath });

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

// 1. listNotes
const notes = await vault.listNotes();
const paths = notes.map((n) => n.path).sort();
check("listNotes finds 3 notes", paths.length === 3, JSON.stringify(paths));
check("listNotes walks nested folder", paths.includes("folder/Sub-note.md"));

// 2. readNote with extension
const welcome = await vault.readNote("Welcome.md");
check("readNote parses title", welcome.title === "Welcome", welcome.title);
check("readNote parses frontmatter", welcome.frontmatter?.tags?.length === 2, JSON.stringify(welcome.frontmatter));
check("readNote strips frontmatter from body", !welcome.body.includes("---") && welcome.body.includes("Welcome to the test vault"));

// 3. readNote without extension
const second = await vault.readNote("Second Note");
check("readNote works without .md extension", second.title === "Second Note");

// 4. search
const hits = await vault.search("harness", { maxResults: 50 });
check("search finds matches", hits.length >= 1, JSON.stringify(hits.map((h) => h.path)));

// 5. path traversal guard
let escaped = false;
try {
  vault.resolveInVault("../../etc/passwd");
} catch {
  escaped = true;
}
check("vault rejects path traversal", escaped);

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
