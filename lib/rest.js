/**
 * Channel B access layer: the Obsidian "Local REST API" community plugin
 * (coddingtonbear). Default endpoint is `https://127.0.0.1:27124` with a
 * self-signed certificate, so the client tolerates that certificate. Auth is an
 * optional API key sent as `Authorization: Bearer <key>`; when no key is
 * configured the plugin answers anonymously.
 *
 * The client probes at construction; when Obsidian/plugin is absent, callers
 * silently degrade to channel A (direct file access).
 */
export class ObsidianApiClient {
    baseUrl;
    token;
    enabled;
    _status = { available: false, reason: "not probed" };
    constructor(opts) {
        this.baseUrl = (opts.baseUrl ?? "http://127.0.0.1:27124").replace(/\/+$/, "");
        this.token = opts.token ?? "";
        this.enabled = opts.enabled ?? true;
    }
    status() {
        return this._status;
    }
    async probe(signal) {
        if (!this.enabled) {
            this._status = { available: false, reason: "disabled by config" };
            return false;
        }
        try {
            const res = await this.rawFetch("/", { method: "GET", signal });
            if (!res.ok) {
                this._status = { available: false, reason: `HTTP ${res.status}` };
                return false;
            }
            const text = await res.text();
            let version;
            let authenticated;
            try {
                const json = JSON.parse(text);
                version = json.version ?? json.service;
                authenticated = json.authenticated;
            }
            catch {
                // Non-JSON root response is still a reachable endpoint.
            }
            if (authenticated === false) {
                this._status = { available: false, reason: "unauthenticated (check apiToken)" };
                return false;
            }
            this._status = { available: true, version, baseUrl: this.baseUrl };
            return true;
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this._status = { available: false, reason: reason.split("\n")[0] };
            return false;
        }
    }
    /** Ensure availability, lazily probing once on first use. */
    async ensure(signal) {
        if (!this._status.available && this.enabled) {
            const ok = await this.probe(signal);
            if (!ok)
                throw new Error(`obsidian-assistant: Obsidian Local REST API unavailable (${this._status.reason})`);
        }
        if (!this._status.available) {
            throw new Error(`obsidian-assistant: Obsidian Local REST API unavailable (${this._status.reason})`);
        }
    }
    /** Invoke an arbitrary endpoint (GET/POST/PUT/DELETE). Path is base-relative. */
    async request(opts) {
        await this.ensure(opts.signal);
        const res = await this.rawFetch(opts.path, { method: opts.method ?? "GET", signal: opts.signal, body: opts.body });
        const text = await res.text();
        let data = text;
        try {
            data = JSON.parse(text);
        }
        catch { /* keep raw text */ }
        if (!res.ok) {
            throw new Error(`obsidian-assistant: REST ${res.status}: ${text.slice(0, 200)}`);
        }
        return { status: res.status, data };
    }
    /** Full-text search through Obsidian's own index (channel B, fast on large vaults). */
    async search(query, opts = {}) {
        await this.ensure(opts.signal);
        // v5.x expects the query as a URL query parameter on a POST, returning a
        // top-level ARRAY of {filename, score, matches:[{match:{start,end,source}, context}]}.
        const q = encodeURIComponent(query);
        const ctx = opts.contextLength != null ? `&contextLength=${opts.contextLength}` : "";
        const res = await this.rawFetch(`/search/simple/?query=${q}${ctx}`, { method: "POST", signal: opts.signal });
        if (!res.ok)
            throw new Error(`obsidian-assistant: search failed HTTP ${res.status}`);
        const raw = await res.json();
        return normalizeSearchMatches(raw);
    }
    /** List all available Obsidian commands (id + name). */
    async listCommands(signal) {
        await this.ensure(signal);
        const res = await this.rawFetch("/commands/", { method: "GET", signal });
        if (!res.ok)
            throw new Error(`obsidian-assistant: list commands failed HTTP ${res.status}`);
        const raw = await res.json();
        return normalizeCommands(raw);
    }
    /** Execute an Obsidian command by its id. */
    async runCommand(commandId, signal) {
        await this.ensure(signal);
        const res = await this.rawFetch(`/commands/${encodeURIComponent(commandId)}`, { method: "POST", signal, body: {} });
        if (!res.ok)
            throw new Error(`obsidian-assistant: run command "${commandId}" failed HTTP ${res.status}`);
    }
    /** Read a note's raw content via the REST API. */
    async readContent(relPath, signal) {
        await this.ensure(signal);
        // Encode each path segment (keep `/` separators), so CJK/brackets survive
        // but directory structure stays intact.
        const encoded = relPath.split("/").map((seg) => encodeURIComponent(seg)).join("/");
        const res = await this.rawFetch(`/vault/${encoded}`, { method: "GET", signal });
        if (!res.ok)
            throw new Error(`obsidian-assistant: read vault path failed HTTP ${res.status}`);
        const text = await res.text();
        // Tolerate both a raw-text body and a {content: ...} wrapper.
        try {
            const json = JSON.parse(text);
            if (typeof json.content === "string")
                return json.content;
        }
        catch { /* not JSON */ }
        return text;
    }
    /**
     * Low-level request. Auth header is applied when a token is configured. For
     * HTTPS endpoints the client tolerates the plugin's self-signed certificate
     * (`rejectUnauthorized: false`); set the optional `rejectUnauthorized` flag
     * to restore strict validation.
     */
    async rawFetch(path, opts) {
        const fullPath = path.startsWith("/") ? path : "/" + path;
        return await requestWithClient(this.baseUrl, fullPath, {
            method: opts.method,
            signal: opts.signal,
            body: opts.body,
            token: this.token,
        });
    }
}
/**
 * Issue an HTTP(S) request against the Local REST API endpoint, tolerating its
 * self-signed certificate. Implemented on node:http/https rather than global
 * fetch so `rejectUnauthorized: false` works without an extra dependency.
 */
async function requestWithClient(baseUrl, path, opts) {
    const url = new URL(`${baseUrl}${path}`);
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? await import("node:https") : await import("node:http");
    const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers = { Accept: "application/json" };
    if (opts.token)
        headers.Authorization = `Bearer ${opts.token}`;
    if (body !== undefined)
        headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(body?.length ?? 0);
    return await new Promise((resolve, reject) => {
        const req = mod.request(url, {
            method: opts.method,
            headers,
            // Tolerate the self-signed cert on https.
            rejectUnauthorized: false,
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                const text = () => Promise.resolve(Buffer.concat(chunks).toString("utf8"));
                const json = () => text().then((t) => JSON.parse(t));
                const status = res.statusCode ?? 0;
                const simple = {
                    ok: status >= 200 && status < 300,
                    status,
                    text,
                    json,
                };
                resolve(simple);
            });
        });
        req.on("error", reject);
        if (opts.signal) {
            opts.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
        }
        if (body !== undefined)
            req.write(body);
        req.end();
    });
}
function normalizeSearchMatches(raw) {
    if (Array.isArray(raw)) {
        return raw.map((m) => normalizeOne(m));
    }
    if (raw && typeof raw === "object") {
        const obj = raw;
        if (Array.isArray(obj.matches))
            return obj.matches.map(normalizeOne);
    }
    return [];
}
function normalizeOne(m) {
    if (m && typeof m === "object") {
        const obj = m;
        const matches = Array.isArray(obj.matches)
            ? obj.matches.map((x) => {
                const o = (x ?? {});
                // v5.x: { match: {start, end, source}, context: "..." }
                const inner = (o.match ?? {});
                return {
                    snippet: typeof o.context === "string"
                        ? o.context
                        : typeof o.snippet === "string"
                            ? o.snippet
                            : typeof o.text === "string"
                                ? o.text
                                : undefined,
                    start: typeof inner.start === "number" ? inner.start : typeof o.start === "number" ? o.start : undefined,
                    end: typeof inner.end === "number" ? inner.end : typeof o.end === "number" ? o.end : undefined,
                };
            })
            : undefined;
        return {
            filename: typeof obj.filename === "string" ? obj.filename : typeof obj.path === "string" ? obj.path : "",
            score: typeof obj.score === "number" ? obj.score : undefined,
            matches,
        };
    }
    return { filename: typeof m === "string" ? m : "" };
}
function normalizeCommands(raw) {
    if (Array.isArray(raw)) {
        return raw
            .filter((c) => !!c && typeof c === "object")
            .map((c) => ({ id: String(c.id ?? ""), name: String(c.name ?? c.id ?? "") }));
    }
    if (raw && typeof raw === "object") {
        const obj = raw;
        if (Array.isArray(obj.commands))
            return normalizeCommands(obj.commands);
        // Some versions return {id: name} maps.
        return Object.entries(obj).map(([id, name]) => ({ id, name: String(name) }));
    }
    return [];
}
