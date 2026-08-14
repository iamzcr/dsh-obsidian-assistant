import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "dsh-obsidian-assistant";
export declare const inject: string[];
/**
 * Schemastery config schema. `vaultPath` is optional here so the published
 * bundle patch can omit it and the plugin still loads; `apply` then fails loud
 * with an actionable message when it is missing or not absolute.
 */
export declare const Config: z<Schemastery.ObjectS<{
    vaultPath: z<string, string>;
    apiUrl: z<string, string>;
    apiToken: z<string, string>;
    enableRestApi: z<boolean, boolean>;
    excludePatterns: z<string[], string[]>;
    maxResults: z<number, number>;
}>, Schemastery.ObjectT<{
    vaultPath: z<string, string>;
    apiUrl: z<string, string>;
    apiToken: z<string, string>;
    enableRestApi: z<boolean, boolean>;
    excludePatterns: z<string[], string[]>;
    maxResults: z<number, number>;
}>>;
/** Resolved config (after schemastery defaults are applied). */
export type ResolvedConfig = Schemastery.TypeT<typeof Config>;
/**
 * Register the obsidian_* toolset on `ctx.tools`, backed by `VaultService`
 * (direct file access) with an optional `ObsidianApiClient` (Local REST API).
 */
export declare function apply(ctx: Context, config: ResolvedConfig): void;
