/**
 * Catalog manifest + completeness/param checker + `.d.ts` generator.
 *
 * Pure over an in-memory list of catalog entries (so it unit-tests without the
 * filesystem); `scanDir` is the thin fs loader used by the Vite plugin and the
 * `sigx-i18n check` CLI. This module is the source of BOTH the generated types
 * ("everything is typed") and the build gate ("build errors if a localization
 * is missing").
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isPluralForms } from './formatter.js';
import type { Catalog, MessageValue } from './types.js';

export type ParamType = 'string' | 'number' | 'date';

/** One loaded catalog file. Namespaces may be hierarchical (`admin/users`). */
export interface CatalogEntry {
    locale: string;
    namespace: string;
    catalog: Catalog;
}

/** Structural description derived from the master locale. */
export interface Manifest {
    masterLocale: string;
    locales: string[];
    /** Master-derived namespaces, plus the declared runtime ones. */
    namespaces: string[];
    /** Namespaces sourced at runtime — in `namespaces`, deliberately absent from `messages`. */
    runtimeNamespaces: string[];
    /** master-derived: messages[namespace][key] = params. */
    messages: Record<string, Record<string, Record<string, ParamType>>>;
}

export interface CheckProblem {
    /** `missing-master`: the namespace has no catalog in the master locale at all. */
    kind: 'missing' | 'param-mismatch' | 'extraneous' | 'missing-master';
    locale: string;
    namespace: string;
    key: string;
    detail?: string;
}

export interface CheckResult {
    errors: CheckProblem[];
    warnings: CheckProblem[];
    ok: boolean;
}

export interface CheckOptions {
    masterLocale: string;
    /** How to treat missing keys / param mismatches. Default `'error'`. */
    strict?: 'error' | 'warn' | 'off';
    /** Keys never required in other locales. Entries as `key` or `namespace:key`. */
    ignoreMissing?: string[];
    /** Locales to skip entirely (work-in-progress). */
    ignoreLocales?: string[];
    /** Namespaces sourced at runtime — exempt from every check (see `I18nViteOptions`). */
    runtimeNamespaces?: string[];
}

// ── Flattening + param extraction ───────────────────────────────────────────

/** Flatten a catalog to dotted-key → leaf message. */
export function flatten(catalog: Catalog, prefix = ''): Map<string, MessageValue> {
    const out = new Map<string, MessageValue>();
    for (const [key, value] of Object.entries(catalog)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string' || isPluralForms(value)) {
            out.set(path, value as MessageValue);
        } else if (value && typeof value === 'object') {
            for (const [k, v] of flatten(value as Catalog, path)) out.set(k, v);
        }
    }
    return out;
}

const TOKEN = /\{\s*(\w+)\s*(?:,\s*(number|date|time)\s*)?\}/g;

/** Extract interpolation params (name → type) from a leaf message. */
export function extractParams(message: MessageValue): Record<string, ParamType> {
    const params: Record<string, ParamType> = {};
    const scan = (str: string) => {
        for (const m of str.matchAll(TOKEN)) {
            const name = m[1];
            const kind = m[2];
            params[name] = kind === 'number' ? 'number' : kind === 'date' || kind === 'time' ? 'date' : 'string';
        }
    };
    if (typeof message === 'string') {
        scan(message);
    } else {
        params.count = 'number';
        for (const form of Object.values(message)) if (typeof form === 'string') scan(form);
    }
    return params;
}

const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

// ── Manifest ────────────────────────────────────────────────────────────────

export function buildManifest(
    entries: CatalogEntry[],
    masterLocale: string,
    runtimeNamespaces: string[] = []
): Manifest {
    const messages: Manifest['messages'] = {};
    for (const e of entries) {
        if (e.locale !== masterLocale) continue;
        if (runtimeNamespaces.includes(e.namespace)) continue;
        const ns = (messages[e.namespace] ??= {});
        for (const [key, value] of flatten(e.catalog)) {
            ns[key] = extractParams(value);
        }
    }
    return {
        masterLocale,
        locales: uniqSorted(entries.map(e => e.locale)),
        // Master-derived + the declared runtime namespaces, so `namespaces` and
        // `messages` can never disagree by accident: a namespace in the union with
        // no `messages` entry is a runtime one, deliberately, and nothing else.
        // (`checkCatalogs` reports any other namespace missing from the master.)
        namespaces: uniqSorted([...Object.keys(messages), ...runtimeNamespaces]),
        runtimeNamespaces: uniqSorted(runtimeNamespaces),
        messages
    };
}

// ── Completeness check ──────────────────────────────────────────────────────

function indexEntries(entries: CatalogEntry[]): Map<string, Map<string, MessageValue>> {
    const map = new Map<string, Map<string, MessageValue>>();
    for (const e of entries) map.set(`${e.locale} ${e.namespace}`, flatten(e.catalog));
    return map;
}

const paramNames = (v: MessageValue) => Object.keys(extractParams(v)).sort().join(',');

export function checkCatalogs(entries: CatalogEntry[], options: CheckOptions): CheckResult {
    const { masterLocale, strict = 'error', ignoreMissing = [], ignoreLocales = [], runtimeNamespaces = [] } = options;
    const ignore = new Set(ignoreMissing);
    const skipLocale = new Set(ignoreLocales);
    const runtime = new Set(runtimeNamespaces);
    const index = indexEntries(entries);
    const locales = uniqSorted(entries.map(e => e.locale)).filter(l => l !== masterLocale && !skipLocale.has(l));

    const problems: CheckProblem[] = [];
    const missingSeverity = strict; // 'error' | 'warn' | 'off'

    const masters = entries.filter(e => e.locale === masterLocale && !runtime.has(e.namespace));

    // A namespace carried only by non-master locales is never reached by the loop
    // below (which is driven by master entries), so check the namespace universe
    // separately — otherwise the gate is silent about a shape of "missing" that
    // also produces an unusable generated type.
    if (missingSeverity !== 'off') {
        const masterNamespaces = new Set(masters.map(e => e.namespace));
        const orphans = uniqSorted(
            entries.filter(e => !skipLocale.has(e.locale) && !runtime.has(e.namespace)).map(e => e.namespace)
        ).filter(ns => !masterNamespaces.has(ns));
        for (const namespace of orphans) {
            problems.push({
                kind: 'missing-master',
                locale: masterLocale,
                namespace,
                key: '*',
                detail: `no ${masterLocale}/${namespace} catalog`
            });
        }
    }

    for (const master of masters) {
        const masterFlat = flatten(master.catalog);
        for (const locale of locales) {
            const localeFlat = index.get(`${locale} ${master.namespace}`) ?? new Map();

            for (const [key, masterValue] of masterFlat) {
                if (ignore.has(key) || ignore.has(`${master.namespace}:${key}`)) continue;
                if (!localeFlat.has(key)) {
                    if (missingSeverity !== 'off') {
                        problems.push({ kind: 'missing', locale, namespace: master.namespace, key });
                    }
                } else if (paramNames(masterValue) !== paramNames(localeFlat.get(key)!)) {
                    if (missingSeverity !== 'off') {
                        problems.push({
                            kind: 'param-mismatch',
                            locale,
                            namespace: master.namespace,
                            key,
                            detail: `master {${paramNames(masterValue)}} vs {${paramNames(localeFlat.get(key)!)}}`
                        });
                    }
                }
            }
            // Extraneous keys (present in locale, absent in master) → always a warning.
            for (const key of localeFlat.keys()) {
                if (!masterFlat.has(key)) {
                    problems.push({ kind: 'extraneous', locale, namespace: master.namespace, key });
                }
            }
        }
    }

    const isError = (p: CheckProblem) => p.kind !== 'extraneous' && missingSeverity === 'error';
    const errors = problems.filter(isError);
    const warnings = problems.filter(p => !isError(p));
    return { errors, warnings, ok: errors.length === 0 };
}

/** Format a check result as a human-readable report. */
export function formatReport(result: CheckResult): string {
    const glyph = { 'param-mismatch': '≠', extraneous: '+', 'missing-master': '!', missing: '−' };
    const line = (p: CheckProblem) =>
        `  ${glyph[p.kind]} ${p.locale}/${p.namespace}: ${p.key}${p.detail ? ` (${p.detail})` : ''}`;
    const parts: string[] = [];
    if (result.errors.length) parts.push(`${result.errors.length} error(s):`, ...result.errors.map(line));
    if (result.warnings.length) parts.push(`${result.warnings.length} warning(s):`, ...result.warnings.map(line));
    if (!parts.length) parts.push('All catalogs complete.');
    return parts.join('\n');
}

// ── .d.ts generation ────────────────────────────────────────────────────────

const q = (s: string) => JSON.stringify(s);
const union = (xs: string[]) => (xs.length ? xs.map(q).join(' | ') : 'never');

function paramsType(params: Record<string, ParamType>): string {
    const keys = Object.keys(params);
    if (!keys.length) return '{}';
    const tsType = (t: ParamType) => (t === 'number' ? 'number' : t === 'date' ? 'Date | number | string' : 'string | number');
    return `{ ${keys.map(k => `${q(k)}: ${tsType(params[k])}`).join('; ')} }`;
}

/** Generate a `.d.ts` that augments `Schema` with the real locales/namespaces/keys/params. */
export function generateDts(manifest: Manifest): string {
    const lines: string[] = [
        '// AUTO-GENERATED by @sigx/i18n/vite — do not edit.',
        "import '@sigx/i18n';",
        '',
        "declare module '@sigx/i18n' {",
        '    interface Schema {',
        `        locales: ${union(manifest.locales)};`,
        `        namespaces: ${union(manifest.namespaces)};`,
        `        runtimeNamespaces: ${union(manifest.runtimeNamespaces)};`,
        '        messages: {'
    ];
    for (const ns of Object.keys(manifest.messages).sort()) {
        lines.push(`            ${q(ns)}: {`);
        for (const key of Object.keys(manifest.messages[ns]).sort()) {
            lines.push(`                ${q(key)}: ${paramsType(manifest.messages[ns][key])};`);
        }
        lines.push('            };');
    }
    lines.push('        };', '    }', '}', '');
    return lines.join('\n');
}

// ── Filesystem scan (fs boundary) ───────────────────────────────────────────

async function readJsonFile(file: string): Promise<Catalog | null> {
    try {
        return JSON.parse(await readFile(file, 'utf-8')) as Catalog;
    } catch (err) {
        if (__DEV__) console.error(`[@sigx/i18n] failed to read ${file}:`, err);
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
 * Scan `localesDir` into catalog entries. Layout is `<locale>/<namespace>.json`;
 * namespaces may be nested (`en/admin/users.json` → namespace `admin/users`).
 */
export async function scanDir(localesDir: string): Promise<CatalogEntry[]> {
    const entries: CatalogEntry[] = [];
    for (const locale of await listDirs(localesDir)) {
        const localeDir = join(localesDir, locale);
        const files = new Map<string, string>();
        await walkJson(localeDir, localeDir, files);
        for (const [namespace, file] of files) {
            const catalog = await readJsonFile(file);
            if (catalog) entries.push({ locale, namespace, catalog });
        }
    }
    return entries;
}
