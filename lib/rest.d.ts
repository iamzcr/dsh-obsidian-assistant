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
export interface RestStatus {
    available: boolean;
    reason?: string;
    version?: string;
    baseUrl?: string;
}
export interface RestSearchMatch {
    filename: string;
    score?: number;
    matches?: Array<{
        snippet?: string;
        start?: number;
        end?: number;
    }>;
}
export interface RestCommand {
    id: string;
    name: string;
}
export declare class ObsidianApiClient {
    readonly baseUrl: string;
    private readonly token;
    private readonly enabled;
    private _status;
    constructor(opts: {
        baseUrl: string;
        token?: string;
        enabled?: boolean;
    });
    status(): RestStatus;
    probe(signal?: AbortSignal): Promise<boolean>;
    /** Ensure availability, lazily probing once on first use. */
    private ensure;
    /** Invoke an arbitrary endpoint (GET/POST/PUT/DELETE). Path is base-relative. */
    request(opts: {
        method?: "GET" | "POST" | "PUT" | "DELETE";
        path: string;
        body?: unknown;
        signal?: AbortSignal;
    }): Promise<{
        status: number;
        data: unknown;
    }>;
    /** Full-text search through Obsidian's own index (channel B, fast on large vaults). */
    search(query: string, opts?: {
        contextLength?: number;
        signal?: AbortSignal;
    }): Promise<RestSearchMatch[]>;
    /** List all available Obsidian commands (id + name). */
    listCommands(signal?: AbortSignal): Promise<RestCommand[]>;
    /** Execute an Obsidian command by its id. */
    runCommand(commandId: string, signal?: AbortSignal): Promise<void>;
    /** Read a note's raw content via the REST API. */
    readContent(relPath: string, signal?: AbortSignal): Promise<string>;
    /**
     * Low-level request. Auth header is applied when a token is configured. For
     * HTTPS endpoints the client tolerates the plugin's self-signed certificate
     * (`rejectUnauthorized: false`); set the optional `rejectUnauthorized` flag
     * to restore strict validation.
     */
    private rawFetch;
}
