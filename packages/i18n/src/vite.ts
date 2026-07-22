/**
 * @sigx/i18n/vite — the build-tool half of the "fully typed" and "build errors
 * if a localization is missing" guarantees.
 *
 *  1. Type codegen: scans the catalog tree and writes a `.d.ts` augmenting
 *     `Schema` with the real targets/locales/namespaces/keys/params.
 *  2. Build gate: in `buildStart`, a non-master locale/target missing a master
 *     key (or a param mismatch) FAILS `vite build`. Configurable strictness +
 *     ignore lists.
 *  3. Dev: watches the catalog tree and triggers a reload (+ re-check + re-gen)
 *     when a locale file changes.
 *
 * The runtime stays untouched — this is pure tooling.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
    buildManifest,
    checkCatalogs,
    generateDts,
    formatReport,
    scanDir,
    type CatalogEntry,
    type CheckResult
} from './manifest.js';
import type { MessageTree } from './types.js';

export interface I18nViteOptions {
    /** Catalog root: `<localesDir>/<locale>/<namespace>.json` (namespaces may be nested). */
    localesDir: string;
    /** Master locale — source of truth for which keys must exist. */
    masterLocale: string;
    /** Where to write the generated `.d.ts`. Default `<localesDir>/../i18n.gen.d.ts`. */
    dtsOutFile?: string;
    /** Emit the generated types. Default true. */
    generateTypes?: boolean;
    /** Run the completeness gate. Default true. */
    check?: boolean;
    /** Severity of missing keys / param mismatches. Default `'error'` (fails the build). */
    strict?: 'error' | 'warn' | 'off';
    /** Keys never required in other locales (`key` or `namespace:key`). */
    ignoreMissing?: string[];
    /** Locales to skip entirely (work-in-progress). */
    ignoreLocales?: string[];
    /**
     * Namespaces that must never reach the browser — mail templates, job
     * notifications, PDF copy. Glob-ish patterns over the namespace path:
     * `*` matches within one segment, `**` across segments (`'mail'`,
     * `'jobs/*'`, `'internal/**'`).
     *
     * They are excluded from `virtual:sigx-i18n/catalogs` and are the entire
     * content of `virtual:sigx-i18n/server-catalogs`.
     */
    serverOnly?: string[];
}

// ── Virtual catalog modules ─────────────────────────────────────────────────
// A bundled edge build (workerd, Deno, the vercel/netlify adapters) has no
// filesystem, so the catalogs have to become code — the same move core made
// with `virtual:sigx-app`. Both ids resolve to an inlined `MessageTree`.

const CLIENT_ID = 'virtual:sigx-i18n/catalogs';
const SERVER_ID = 'virtual:sigx-i18n/server-catalogs';
const RESOLVED = (id: string) => `\0${id}`;

/** Compile a namespace glob (`*` within a segment, `**` across) to a regexp. */
function namespaceMatcher(patterns: string[] | undefined): (namespace: string) => boolean {
    if (!patterns || patterns.length === 0) return () => false;
    const regexps = patterns.map(pattern => {
        const source = pattern
            .split('**')
            .map(part =>
                part
                    .split('*')
                    .map(chunk => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                    .join('[^/]*')
            )
            .join('.*');
        return new RegExp(`^${source}$`);
    });
    return namespace => regexps.some(re => re.test(namespace));
}

/** Build the `messages[locale][namespace]` tree for the entries a side is allowed to see. */
function treeFor(entries: CatalogEntry[], keep: (entry: CatalogEntry) => boolean): MessageTree {
    const tree: MessageTree = {};
    for (const entry of entries) {
        if (!keep(entry)) continue;
        (tree[entry.locale] ??= {})[entry.namespace] = entry.catalog;
    }
    return tree;
}

function dtsPath(options: I18nViteOptions): string {
    return options.dtsOutFile ? resolve(options.dtsOutFile) : resolve(join(options.localesDir, '..', 'i18n.gen.d.ts'));
}

/** Run the completeness check over the catalog tree on disk. */
export async function runI18nCheck(options: I18nViteOptions): Promise<CheckResult> {
    const entries = await scanDir(options.localesDir);
    return checkCatalogs(entries, {
        masterLocale: options.masterLocale,
        strict: options.strict,
        ignoreMissing: options.ignoreMissing,
        ignoreLocales: options.ignoreLocales
    });
}

/** Generate the `.d.ts` and write it (only when the content changed). Returns the path. */
export async function writeI18nTypes(options: I18nViteOptions): Promise<string> {
    const entries = await scanDir(options.localesDir);
    const manifest = buildManifest(entries, options.masterLocale);
    const content = generateDts(manifest);
    const out = dtsPath(options);
    let existing: string | null = null;
    try {
        existing = await readFile(out, 'utf-8');
    } catch {
        /* not written yet */
    }
    if (existing !== content) {
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, content, 'utf-8');
    }
    return out;
}

/**
 * The Vite plugin. Add to `vite.config`:
 * ```ts
 * import { i18n } from '@sigx/i18n/vite';
 * export default { plugins: [i18n({ localesDir: 'src/locales', masterLocale: 'en' })] };
 * ```
 */
export function i18n(options: I18nViteOptions): Plugin {
    const genTypes = options.generateTypes ?? true;
    const doCheck = options.check ?? true;
    const out = dtsPath(options);

    const regenerate = async (): Promise<void> => {
        if (genTypes) await writeI18nTypes(options);
    };

    const runGate = async (fail: (msg: string) => void): Promise<void> => {
        if (!doCheck) return;
        const result = await runI18nCheck(options);
        if (result.warnings.length) {
            console.warn(`\n[@sigx/i18n] catalog warnings:\n${formatReport({ ...result, errors: [] })}\n`);
        }
        if (!result.ok) {
            fail(`[@sigx/i18n] incomplete catalogs — build blocked:\n${formatReport({ ...result, warnings: [] })}`);
        }
    };

    const isServerOnly = namespaceMatcher(options.serverOnly);
    // Scanned once per build/dev-session and dropped whenever a catalog file
    // changes, so `load` never re-walks the tree per importing module.
    let entries: Promise<CatalogEntry[]> | null = null;
    const catalogEntries = (): Promise<CatalogEntry[]> => (entries ??= scanDir(options.localesDir));

    return {
        name: '@sigx/i18n',

        async buildStart() {
            entries = null;
            await regenerate();
            // `this.error` aborts the build (Rollup/Vite) with the message.
            await runGate(msg => this.error(msg));
        },

        resolveId(id) {
            if (id === CLIENT_ID || id === SERVER_ID) return RESOLVED(id);
            return null;
        },

        async load(id) {
            if (id !== RESOLVED(CLIENT_ID) && id !== RESOLVED(SERVER_ID)) return null;
            const all = await catalogEntries();
            const wantServer = id === RESOLVED(SERVER_ID);
            const tree = treeFor(all, e => isServerOnly(e.namespace) === wantServer);
            return `export default ${JSON.stringify(tree)};`;
        },

        async configureServer(server) {
            const dir = resolve(options.localesDir);
            // Generate types up front, then tell Vite's core watcher to IGNORE the
            // generated `.d.ts` — otherwise writing it triggers a full page reload
            // (and a reload storm at dev startup). We react to catalog `.json`
            // changes ourselves below.
            await regenerate();
            server.watcher.add(dir);
            server.watcher.unwatch(out);
            const onChange = async (file: string) => {
                const norm = resolve(file);
                if (!norm.startsWith(dir) || !norm.endsWith('.json') || norm === out) return;
                // Drop the scan cache and evict both virtual modules, so an
                // importer of the inlined tree sees the edit and not a stale
                // literal baked in at first load.
                entries = null;
                for (const virtualId of [CLIENT_ID, SERVER_ID]) {
                    const mod = server.moduleGraph.getModuleById(RESOLVED(virtualId));
                    if (mod) server.moduleGraph.invalidateModule(mod);
                }
                await regenerate();
                // Report (don't crash the dev server) then reload the page.
                await runGate(msg => server.config.logger.error(msg));
                server.ws.send({ type: 'full-reload' });
            };
            server.watcher.on('add', onChange);
            server.watcher.on('change', onChange);
            server.watcher.on('unlink', onChange);
        }
    };
}

export { generateDts, buildManifest, checkCatalogs, scanDir, formatReport } from './manifest.js';
export type { Manifest, CatalogEntry, CheckResult, CheckProblem } from './manifest.js';
