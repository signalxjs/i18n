/**
 * @sigx/i18n/server — a non-reactive, DI-free translator for server-only
 * localization: mail templates, queue jobs, API responses, PDFs.
 *
 * It reuses the exact same pure `translate` core (master fallback, locale chain)
 * and formatter as the client, but has zero dependency on sigx — no store, no
 * signals, no app — so it runs in a mailer worker with nothing else wired up.
 * Catalogs are read from the filesystem once and cached in memory.
 *
 * Server-only namespaces are simply files that live under `localesDir` and are
 * never exposed to the client loader's glob.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import type { Catalog, Formatter, MessageTree, MissingInfo, Params } from './types.js';

export interface ServerI18nOptions {
    /** Root catalog directory: `<localesDir>/<locale>/<namespace>.json` (namespaces may be nested). */
    localesDir: string;
    /** Master locale, used when a key is untranslated. */
    fallbackLocale: string;
    /** Default namespace when a call omits one. Default `'translation'`. */
    defaultNamespace?: string;
    /** Explicit locale fallbacks layered on BCP-47 truncation. */
    localeFallbacks?: Record<string, string>;
    /** Message formatter (defaults to `lightweightFormatter`). */
    formatter?: Formatter;
    /** Missing-key handler. */
    onMissing?: (info: MissingInfo) => string;
}

/** Per-call scope override. */
export interface ServerScope {
    locale?: string;
    namespace?: string;
}

export interface ServerTranslator {
    /** Translate a key. `scope.locale` defaults to the master locale. */
    t(key: string, params?: Params, scope?: ServerScope): string;
    /** Bind a locale (and optional namespace) into a simple `(key, params) => string`. */
    forLocale(locale: string, scope?: Omit<ServerScope, 'locale'>): (key: string, params?: Params) => string;
    /** The loaded message tree (locale → namespace → catalog), for inspection. */
    readonly messages: MessageTree;
}

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
 * Create a server translator, eagerly reading and caching every catalog under
 * `localesDir`. Layout is `<locale>/<namespace>.json`; namespaces may be nested
 * (`en/admin/users.json` → namespace `admin/users`).
 */
export async function createServerT(options: ServerI18nOptions): Promise<ServerTranslator> {
    const {
        localesDir,
        fallbackLocale,
        defaultNamespace = 'translation',
        localeFallbacks,
        formatter = lightweightFormatter,
        onMissing
    } = options;

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

    const tconfig = { fallbackLocale, localeFallbacks, formatter, onMissing };

    const t: ServerTranslator['t'] = (key, params, scope) =>
        translate(
            tree,
            key,
            params,
            { locale: scope?.locale ?? fallbackLocale, namespace: scope?.namespace ?? defaultNamespace },
            tconfig
        );

    const forLocale: ServerTranslator['forLocale'] = (locale, scope) => (key, params) =>
        t(key, params, { locale, namespace: scope?.namespace });

    return { t, forLocale, messages: tree };
}
