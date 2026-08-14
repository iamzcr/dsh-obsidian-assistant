// Channel-B live smoke test against a running Local REST API plugin.
// Usage: OBSIDIAN_API_KEY=<key> OBSIDIAN_API_URL=https://127.0.0.1:27124 node scripts/rest-smoke.mjs
import { ObsidianApiClient } from "../lib/rest.js";

const baseUrl = process.env.OBSIDIAN_API_URL ?? "https://127.0.0.1:27124";
const token = process.env.OBSIDIAN_API_KEY ?? "";

const client = new ObsidianApiClient({ baseUrl, token, enabled: true });

let failures = 0;
function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}

const ok = await client.probe();
check("probe available", ok === true, JSON.stringify(client.status()));

if (ok) {
  const matches = await client.search("harness");
  check("search works", Array.isArray(matches), `matches=${matches.length}`);

  const cmds = await client.listCommands();
  check("listCommands works", cmds.length > 0, `count=${cmds.length}`);
}

console.log(failures === 0 ? "\nREST SMOKE PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
