/**
 * @sigx/i18n/server/node — the filesystem half of the server translator.
 *
 * Reads `<localesDir>/<locale>/<namespace>.json` into a `MessageTree` that
 * `createServerT` (universal, `@sigx/i18n/server`) consumes. This is the ONLY
 * entry with `node:` imports; it is deliberately split off so an edge or
 * bundled-worker build can use the translator without pulling `node:fs` into a
 * graph that forbids it.
 *
 * ```ts
 * import { createServerT } from '@sigx/i18n/server';
 * import { loadCatalogs } from '@sigx/i18n/server/node';
 *
 * const t = createServerT({
 *     catalogs: await loadCatalogs('src/locales'),
 *     fallbackLocale: 'en',
 *     defaultNamespace: 'mail'
 * });
 * ```
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Catalog, MessageTree } from './types.js';

async function readCatalog(file: string): Promise<Catalog | null> {
    try {
        return JSON.parse(await readFile(file, 'utf-8')) as Catalog;
    } catch (err) {
        if (__DEV__) console.error(`[@sigx/i18n/server] failed to read ${file}:`, err);
        return null;
    }
}

async function listDirs(dir: string): Promise<string[]> {
    try {
        return (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return [];
    }
}

/** Recursively collect every `*.json` under `dir`, keyed by its namespace path (POSIX-style). */
async function walkJson(dir: string, base: string, out: Map<string, string>): Promise<void> {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            await walkJson(full, base, out);
        } else if (e.isFile() && e.name.endsWith('.json')) {
            const ns = relative(base, full).slice(0, -'.json'.length).split(sep).join('/');
            out.set(ns, full);
        }
    }
}

/**
 * Read every catalog under `localesDir` into a `MessageTree`.
 * Layout is `<locale>/<namespace>.json`; namespaces may be nested
 * (`en/admin/users.json` → namespace `admin/users`).
 */
export async function loadCatalogs(localesDir: string): Promise<MessageTree> {
    const tree: MessageTree = {};
    for (const locale of await listDirs(localesDir)) {
        const localeDir = join(localesDir, locale);
        const files = new Map<string, string>();
        await walkJson(localeDir, localeDir, files);
        for (const [ns, file] of files) {
            const catalog = await readCatalog(file);
            if (catalog) {
                tree[locale] ??= {};
                tree[locale][ns] = catalog;
            }
        }
    }
    return tree;
}

// Re-exported so a Node caller needs one import line, not two.
export { createServerT, createRequestT } from './server.js';
export type {
    ServerI18nOptions,
    ServerScope,
    ServerTranslator,
    RequestTranslator,
    RequestTOptions
} from './server.js';
