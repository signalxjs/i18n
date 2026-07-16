/**
 * @sigx/i18n/server — a non-reactive, DI-free translator for server-only
 * localization: mail templates, queue jobs, API responses, PDFs.
 *
 * It reuses the exact same pure `translate` core (master fallback, locale chain,
 * target chain) and formatter as the client, but has zero dependency on sigx —
 * no store, no signals, no app — so it runs in a mailer worker with nothing else
 * wired up. Catalogs are read from the filesystem once and cached in memory.
 *
 * Server-only namespaces are simply files that live under `localesDir` and are
 * never exposed to the client loader's glob.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import type {
    Catalog,
    Formatter,
    MessageTree,
    MissingInfo,
    Params,
    TargetDef
} from './types.js';

export interface ServerI18nOptions {
    /** Root catalog directory: `<localesDir>/[<target>/]<locale>/<namespace>.json`. */
    localesDir: string;
    /** Master locale (default target used when a key is untranslated). */
    fallbackLocale: string;
    /** Default target when a call omits one. Default `''`. */
    defaultTarget?: string;
    /** Default namespace when a call omits one. Default `'translation'`. */
    defaultNamespace?: string;
    /** Target graph (`extends`). When provided, the layout is 3-level (`target/locale/ns.json`). */
    targets?: Record<string, TargetDef>;
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
    target?: string;
}

export interface ServerTranslator {
    /** Translate a key. `scope.locale` defaults to the master locale. */
    t(key: string, params?: Params, scope?: ServerScope): string;
    /** Bind a locale (and optional namespace/target) into a simple `(key, params) => string`. */
    forLocale(locale: string, scope?: Omit<ServerScope, 'locale'>): (key: string, params?: Params) => string;
    /** The loaded message tree (target → locale → namespace → catalog), for inspection. */
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
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
        return [];
    }
}

async function listJson(dir: string): Promise<string[]> {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name);
    } catch {
        return [];
    }
}

function set(tree: MessageTree, target: string, locale: string, ns: string, catalog: Catalog): void {
    tree[target] ??= {};
    tree[target][locale] ??= {};
    tree[target][locale][ns] = catalog;
}

/** Load one `locale/` directory of namespace files into `tree[target][locale]`. */
async function loadLocaleDir(dir: string, tree: MessageTree, target: string, locale: string): Promise<void> {
    for (const fileName of await listJson(dir)) {
        const ns = fileName.slice(0, -'.json'.length);
        const catalog = await readCatalog(join(dir, fileName));
        if (catalog) set(tree, target, locale, ns, catalog);
    }
}

/**
 * Create a server translator, eagerly reading and caching every catalog under
 * `localesDir`. Layout is `target/locale/ns.json` when `targets` is configured,
 * else `locale/ns.json` (a single default `''` target).
 */
export async function createServerT(options: ServerI18nOptions): Promise<ServerTranslator> {
    const {
        localesDir,
        fallbackLocale,
        defaultTarget = '',
        defaultNamespace = 'translation',
        targets,
        localeFallbacks,
        formatter = lightweightFormatter,
        onMissing
    } = options;

    const tree: MessageTree = {};
    const threeLevel = !!(targets && Object.keys(targets).length);

    if (threeLevel) {
        for (const target of await listDirs(localesDir)) {
            const targetDir = join(localesDir, target);
            for (const locale of await listDirs(targetDir)) {
                await loadLocaleDir(join(targetDir, locale), tree, target, locale);
            }
        }
    } else {
        for (const locale of await listDirs(localesDir)) {
            await loadLocaleDir(join(localesDir, locale), tree, '', locale);
        }
    }

    const tconfig = { fallbackLocale, localeFallbacks, targets, formatter, onMissing };

    const t: ServerTranslator['t'] = (key, params, scope) =>
        translate(
            tree,
            key,
            params,
            {
                target: scope?.target ?? defaultTarget,
                locale: scope?.locale ?? fallbackLocale,
                namespace: scope?.namespace ?? defaultNamespace
            },
            tconfig
        );

    const forLocale: ServerTranslator['forLocale'] = (locale, scope) => (key, params) =>
        t(key, params, { locale, namespace: scope?.namespace, target: scope?.target });

    return { t, forLocale, messages: tree };
}
