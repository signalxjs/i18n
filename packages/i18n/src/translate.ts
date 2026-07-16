/**
 * The pure translation core — no signals, no DI, no DOM. Shared verbatim by the
 * reactive store (client) and `createServerT` (server).
 *
 * Resolution widens along two independent axes before giving up:
 *   target → its `extends` chain,  then  locale → BCP-47 truncation → master.
 * The message is formatted in the locale it was *found* in, so plural rules match
 * the actual translation.
 */

import { isPluralForms } from './formatter.js';
import type {
    Catalog,
    MessageTree,
    MessageValue,
    Params,
    ResolveScope,
    TranslateConfig
} from './types.js';

/** A leaf is a string or a `PluralForms` object; anything else is a nested group. */
function isLeaf(value: unknown): value is MessageValue {
    return typeof value === 'string' || isPluralForms(value);
}

/**
 * Resolve a dotted key inside one catalog. Tries a flat dotted property first
 * (`{ "cart.title": … }`), then walks nested groups (`{ cart: { title: … } }`).
 * Returns `undefined` when the key is absent or resolves to a non-leaf group.
 */
export function getMessage(catalog: Catalog, key: string): MessageValue | undefined {
    const direct = catalog[key];
    if (direct !== undefined && isLeaf(direct)) return direct;

    if (key.indexOf('.') === -1) return undefined;

    let node: unknown = catalog;
    for (const seg of key.split('.')) {
        if (typeof node !== 'object' || node === null || isPluralForms(node)) return undefined;
        node = (node as Record<string, unknown>)[seg];
        if (node === undefined) return undefined;
    }
    return isLeaf(node) ? node : undefined;
}

/**
 * Build the locale fallback chain: the requested locale, any explicit mapping,
 * BCP-47 truncations (`sv-FI` → `sv`), and finally the master locale. Deduped,
 * order preserved.
 */
export function localeChain(
    locale: string,
    fallbackLocale: string,
    explicit?: Record<string, string>
): string[] {
    const chain: string[] = [];
    const add = (l: string | undefined) => {
        if (l && !chain.includes(l)) chain.push(l);
    };
    let cur: string | undefined = locale;
    while (cur) {
        add(cur);
        add(explicit?.[cur]);
        const idx = cur.lastIndexOf('-');
        cur = idx > 0 ? cur.slice(0, idx) : undefined;
    }
    add(fallbackLocale);
    return chain;
}

/** Build the target chain: the active target then its `extends` ancestors. Cycle-safe. */
export function targetChain(
    target: string,
    targets?: Record<string, { extends?: string }>
): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = target;
    while (cur !== undefined && !seen.has(cur)) {
        seen.add(cur);
        chain.push(cur);
        cur = targets?.[cur]?.extends;
    }
    return chain;
}

/**
 * Best-fit negotiation: pick the supported locale closest to `requested`,
 * matching along the BCP-47 chain and then by primary subtag, before falling
 * back to the master (or the first supported locale). With no `supported` list
 * the requested locale is accepted verbatim.
 */
export function matchLocale(
    requested: string,
    supported: readonly string[] | undefined,
    fallbackLocale: string
): string {
    if (!supported || supported.length === 0) return requested;
    for (const cand of localeChain(requested, fallbackLocale)) {
        if (supported.includes(cand)) return cand;
        const primary = cand.split('-')[0];
        const byPrimary = supported.find(s => s.split('-')[0] === primary);
        if (byPrimary) return byPrimary;
    }
    return supported.includes(fallbackLocale) ? fallbackLocale : supported[0];
}

/**
 * Translate a key within a `(target, locale, namespace)` scope against a message
 * tree, applying target + locale fallback. Returns the formatted string, or the
 * configured missing-key result (default: the key itself, with a dev warning).
 */
export function translate(
    tree: MessageTree,
    key: string,
    params: Params | undefined,
    scope: ResolveScope,
    config: TranslateConfig
): string {
    const targets = targetChain(scope.target, config.targets);
    const locales = localeChain(scope.locale, config.fallbackLocale, config.localeFallbacks);

    for (const t of targets) {
        const byLocale = tree[t];
        if (!byLocale) continue;
        for (const l of locales) {
            const cat = byLocale[l]?.[scope.namespace];
            if (!cat) continue;
            const msg = getMessage(cat, key);
            if (msg !== undefined) {
                return config.formatter.format(msg, params, { locale: l, key });
            }
        }
    }

    if (config.onMissing) {
        return config.onMissing({
            key,
            namespace: scope.namespace,
            locale: scope.locale,
            target: scope.target
        });
    }
    if (__DEV__) {
        console.warn(
            `[@sigx/i18n] missing translation "${key}" ` +
            `(ns=${scope.namespace}, locale=${scope.locale}, target=${scope.target || 'default'}).`
        );
    }
    return key;
}
