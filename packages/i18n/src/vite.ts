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
import { buildManifest, checkCatalogs, generateDts, formatReport, scanDir, type CheckResult } from './manifest.js';
import type { TargetDef } from './types.js';

export interface I18nViteOptions {
    /** Catalog root: `<localesDir>/[<target>/]<locale>/<namespace>.json`. */
    localesDir: string;
    /** Master locale — source of truth for which keys must exist. */
    masterLocale: string;
    /** Target graph (enables 3-level `target/locale/ns.json` layout). */
    targets?: Record<string, TargetDef>;
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
}

function dtsPath(options: I18nViteOptions): string {
    return options.dtsOutFile ? resolve(options.dtsOutFile) : resolve(join(options.localesDir, '..', 'i18n.gen.d.ts'));
}

/** Run the completeness check over the catalog tree on disk. */
export async function runI18nCheck(options: I18nViteOptions): Promise<CheckResult> {
    const entries = await scanDir(options.localesDir, { targets: options.targets });
    return checkCatalogs(entries, {
        masterLocale: options.masterLocale,
        strict: options.strict,
        ignoreMissing: options.ignoreMissing,
        ignoreLocales: options.ignoreLocales
    });
}

/** Generate the `.d.ts` and write it (only when the content changed). Returns the path. */
export async function writeI18nTypes(options: I18nViteOptions): Promise<string> {
    const entries = await scanDir(options.localesDir, { targets: options.targets });
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

    return {
        name: '@sigx/i18n',

        async buildStart() {
            await regenerate();
            // `this.error` aborts the build (Rollup/Vite) with the message.
            await runGate(msg => this.error(msg));
        },

        configureServer(server) {
            const dir = resolve(options.localesDir);
            server.watcher.add(dir);
            const onChange = async (file: string) => {
                const norm = resolve(file);
                if (!norm.startsWith(dir) || !norm.endsWith('.json') || norm === out) return;
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
