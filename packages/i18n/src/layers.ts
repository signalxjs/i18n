/**
 * Layered catalogs — the ordered override axis, shared verbatim by the reactive
 * client store and the DI-free server translator.
 *
 * A library or product ships default catalogs; a downstream app, or one
 * per-tenant deployment of it, wants to change a handful of strings. *"Our
 * checkout says Basket, not Cart."* Everything else must keep coming from the
 * shipped catalog, **including keys added in later versions** — which is why an
 * override has to resolve per KEY, not per catalog.
 *
 * Layers are ordered low→high; the highest layer holding a key wins. Layers are
 * composed **within one locale**, and the locale chain is walked afterwards by
 * the untouched `lookup` — so a `base` message in the requested locale beats a
 * `tenant` override that exists only in a fallback locale. That ordering keeps
 * the invariant that a message is formatted in the locale it was *found* in,
 * which plural selection depends on.
 *
 * This module is free of sigx and of `node:`, so `@sigx/i18n/server` can use it;
 * `__tests__/edge-clean.test.ts` pins both.
 */

import { isPluralForms } from './formatter.js';
import type { Catalog, MessageTree, MessageValue } from './types.js';

/** Ordered layer name → its own catalog tree. `messages[layer][locale][namespace]`. */
export type LayeredMessages = Record<string, MessageTree>;

/** The implicit layer when a consumer declares none — today's single-source behaviour. */
export const BASE_LAYER = 'base';

/**
 * Flatten a catalog to dotted-key → leaf message.
 *
 * Lives here rather than in `manifest.ts` because that module imports `node:fs`
 * and this one is reachable from the server entry. `manifest.ts` re-exports it,
 * so there is exactly one flattener.
 */
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

// ── Composition cache ────────────────────────────────────────────────────────
// Composing is pure in its inputs, so the result is cached MODULE-LEVEL and
// shared by every store instance and every server translator in the process: an
// SSR process serving a thousand requests for the same tenant composes once.
//
// The cache is keyed by the IDENTITY of the participating catalogs, in order,
// through a WeakMap trie. That is what makes a global cache safe in a
// multi-tenant server: tenant A's catalog object can never key tenant B's
// result, and the cache holds no tenant identifier and no request state. WeakMap
// also means a dropped override takes its entries with it, so a long-lived
// server does not grow without bound.
//
// The contract this buys is that a registered catalog must be treated as
// IMMUTABLE. Mutating one in place would leave a stale composition. The store
// already assigns rather than mutates, and loaders return fresh objects.

interface CacheNode {
    value?: Catalog;
    next: WeakMap<Catalog, CacheNode>;
}

const cacheRoot: WeakMap<Catalog, CacheNode> = new WeakMap();

/** Flattening is memoised per catalog — one catalog takes part in many stacks. */
const flatCache: WeakMap<Catalog, Map<string, MessageValue>> = new WeakMap();

function flatOf(catalog: Catalog): Map<string, MessageValue> {
    let flat = flatCache.get(catalog);
    if (!flat) {
        flat = flatten(catalog);
        flatCache.set(catalog, flat);
    }
    return flat;
}

/**
 * Merge ordered catalogs into one effective catalog — later wins, per key.
 *
 * Both key shapes are normalised before merging. `getMessage` accepts a flat
 * dotted property (`{ "cart.title": … }`) *and* a nested group
 * (`{ cart: { title } }`) for the same key, so a plain deep merge would let a
 * nested override silently fail to shadow a flat base. Flattening both sides
 * first makes the two spellings interchangeable, which is what a consumer
 * storing overrides in a database will assume.
 *
 * The single-catalog case returns the input **by identity** — no merge, no
 * allocation, no cache entry — so a consumer using no layers pays nothing.
 */
export function composeCatalogs(catalogs: readonly Catalog[]): Catalog {
    if (catalogs.length === 0) return {};
    if (catalogs.length === 1) return catalogs[0];

    // Walk one trie level per catalog identity; the leaf holds the composition.
    let level = cacheRoot;
    let node!: CacheNode;
    for (const catalog of catalogs) {
        const found: CacheNode | undefined = level.get(catalog);
        node = found ?? { next: new WeakMap() };
        if (!found) level.set(catalog, node);
        level = node.next;
    }
    if (node.value) return node.value;

    // Flat dotted keys throughout: `getMessage` tries a flat property before
    // walking nested groups, so the composed catalog resolves identically while
    // being trivial to merge.
    const merged: Catalog = {};
    for (const catalog of catalogs) {
        for (const [key, value] of flatOf(catalog)) merged[key] = value;
    }
    node.value = merged;
    return merged;
}

/**
 * Build the effective tree for one `(locale, namespace)` across an ordered layer
 * stack, or `undefined` when no layer has that pair. Used by both sides to fill
 * their effective view lazily.
 */
export function composeAt(
    layered: LayeredMessages,
    order: readonly string[],
    locale: string,
    namespace: string
): Catalog | undefined {
    const stack: Catalog[] = [];
    for (const layer of order) {
        const cat = layered[layer]?.[locale]?.[namespace];
        if (cat) stack.push(cat);
    }
    return stack.length === 0 ? undefined : composeCatalogs(stack);
}

/**
 * Which layer supplies `key` at `locale`, walking high→low — the provenance
 * behind `explain()`. Returns `undefined` when no layer has it at that locale
 * (the caller walks the locale chain).
 */
export function layerFor(
    layered: LayeredMessages,
    order: readonly string[],
    locale: string,
    namespace: string,
    key: string
): string | undefined {
    for (let i = order.length - 1; i >= 0; i--) {
        const cat = layered[order[i]]?.[locale]?.[namespace];
        if (cat && flatOf(cat).has(key)) return order[i];
    }
    return undefined;
}
