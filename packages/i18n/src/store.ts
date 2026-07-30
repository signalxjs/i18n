/**
 * The reactive i18n engine — a scoped `@sigx/store` so SSR gives one instance
 * per request (no module-global locale). Wraps the pure `translate` core with
 * reactive `locale` / `messages` state and lazy per-namespace loading.
 *
 * Config is read from the `useI18nConfig` injectable, which the `createI18n`
 * plugin provides at app level (see `plugin.ts`). Detection, persistence and SSR
 * transfer are composed on top in `detect.ts` / `persist-ssr.ts`.
 */

import { defineInjectable } from '@sigx/runtime-core';
import { computed, signal } from '@sigx/reactivity';
import { defineStore, type SetupStoreContext } from '@sigx/store';
import { localeChain, lookup, matchLocale, translateWith } from './translate.js';
import { BASE_LAYER, composeAt, layerFor, type LayeredMessages } from './layers.js';
import { lightweightFormatter } from './formatter.js';
import { createDetectors, detectLocale, type DetectionOptions } from './detect.js';
import { installPersistSSR, type PersistSSROptions } from './persist-ssr.js';
import type {
    Catalog,
    Formatter,
    MessageTree,
    MissingInfo,
    Params,
    TranslateConfig,
    TranslateOptions
} from './types.js';

/**
 * Loads one catalog for a `(locale, namespace)`. May return the catalog directly
 * or an ESM module with a `default`. Namespaces may be hierarchical (`admin/users`).
 */
export type LocaleLoader = (locale: string, namespace: string) => Promise<Catalog | { default: Catalog }>;

/** A catalog load that failed, as surfaced by `useLocale().error`. */
export interface I18nLoadError {
    /** Whatever the loader rejected with. */
    error: unknown;
    locale: string;
    namespace: string;
}

/** Fully-resolved runtime config consumed by the store (defaults already applied). */
export interface I18nRuntimeConfig {
    /** Master locale — source of truth for which keys exist. */
    fallbackLocale: string;
    /** Locale to start on before detection (defaults to `fallbackLocale`). */
    initialLocale?: string;
    /** Negotiation target set; empty/undefined accepts any locale. */
    supported?: string[];
    /** Explicit locale fallbacks layered on BCP-47 truncation. */
    localeFallbacks?: Record<string, string>;
    /** Message formatter (defaults to `lightweightFormatter`). */
    formatter?: Formatter;
    /** Namespaces always loaded up front. Leave section-specific ones out so they load on use. */
    namespaces?: string[];
    /** Namespace used when `useTranslation()` is called without one. Default `'translation'`. */
    defaultNamespace?: string;
    /** Catalog loader; when absent, catalogs must be supplied via `addMessages`. */
    load?: LocaleLoader;
    /**
     * Ordered override layers, **lowest priority first**. Declaring them turns on
     * per-KEY layering: an override layer supplies a handful of keys and every
     * other key still falls through to the layer below, including keys the base
     * gains in a later version.
     *
     * Layers compose *within* one locale, and the locale chain is walked after —
     * so a `base` message in the requested locale beats a `tenant` override that
     * exists only in a fallback locale. That keeps a message formatted in the
     * locale it was found in, which plural selection depends on.
     *
     * Omit for the single-source behaviour; nothing is composed and nothing is
     * allocated.
     */
    layers?: string[];
    /** Where `load` / `addMessages` land when no layer is named. Default: the lowest layer. */
    defaultLayer?: string;
    /** Per-layer loaders. `load` is the loader for `defaultLayer`. */
    loaders?: Record<string, LocaleLoader>;
    /**
     * Seed whole layers at creation — the bulk front door for overrides already
     * in hand, e.g. one query that returns every namespace for a tenant.
     * Shape: `layerMessages[layer][locale][namespace]`.
     */
    layerMessages?: LayeredMessages;
    /**
     * Catalogs to seed synchronously at creation (marked loaded, so no refetch).
     * The idiomatic SSR preload: load the request's catalogs, pass them here, and
     * the render stays synchronous while `ssrState` still transfers them to the
     * client. Shape: `messages[locale][namespace]`.
     */
    initialMessages?: MessageTree;
    /** Missing-key handler. */
    onMissing?: (info: MissingInfo) => string;
    /**
     * Called when a catalog load rejects. A bundled `import()` failing is a
     * broken build; a `fetch` failing is Tuesday — so the failure is surfaced
     * (see also `useLocale().error` / `.retry()`) instead of only logged.
     * Providing a handler replaces the default console logging.
     */
    onLoadError?: (err: unknown, info: { locale: string; namespace: string }) => void;
    /** Run locale detection at init (default true). */
    detect?: boolean;
    /** Detection chain options (order, cookie/url names, server request context). */
    detection?: DetectionOptions;
    /** Persistence + SSR transfer settings, or `false` to disable both. */
    persistence?: PersistSSROptions | false;
}

/**
 * The client-side config seam (`docs/seams.md` shape): a resumable page has NO
 * app on the client — `@sigx/resume` hydrates an upgraded boundary through
 * `hydrateComponent` directly, so "app-less pages need no explicit client
 * bootstrap" and there is no DI scope to have installed `createI18n` into.
 *
 * A boundary that translates against state which changes client-side therefore
 * needs the config to reach it some other way: its chunk (or a module its chunk
 * imports) calls `provideI18nConfig`, which stamps this global. The chunk loads
 * only on upgrade, so a zero-JS page stays zero-JS.
 */
declare global {
    // eslint-disable-next-line no-var
    var __SIGX_I18N_CONFIG__: I18nRuntimeConfig | undefined;
}

/**
 * App-provided i18n config. Required (string-form injectable): resolving the
 * store without the `createI18n` plugin installed throws a structured DI error,
 * which is the intended failure mode.
 */
export const useI18nConfig = defineInjectable<I18nRuntimeConfig>('sigx:i18n:config');

/**
 * DI first, the client seam second.
 *
 * Deliberately NOT a factory-form injectable with the seam read inside it: a
 * factory's result is memoized as a global singleton, so the first resolution
 * would pin the config forever — the seam could never be re-stamped, and the
 * "nothing provided it" error could only ever be raised once per process.
 */
function resolveConfig(): I18nRuntimeConfig {
    try {
        return useI18nConfig();
    } catch (diError) {
        const seam = globalThis.__SIGX_I18N_CONFIG__;
        if (seam) return seam;
        if (__DEV__) {
            // No `{ cause }` — the package targets ES2020, so it isn't in lib.
            // The DI error's own text is appended instead, keeping SIGX202 visible.
            throw new Error(
                '[@sigx/i18n] no i18n config available. Install the plugin on the app ' +
                    '(`app.use(createI18n({ … }))`), or — on a resumable page, where an upgraded ' +
                    'boundary hydrates with no app at all — call `provideI18nConfig({ … })` from a ' +
                    "module that boundary's chunk imports.\n\nUnderlying DI error: " +
                    (diError instanceof Error ? diError.message : String(diError))
            );
        }
        throw diError;
    }
}

// A load is identified by (layer, locale, ns): the base catalog and an override
// layer can each load the same pair without one silently suppressing the other.
const loadKey = (layer: string, l: string, ns: string) => `${layer} ${l} ${ns}`;
// The namespace goes LAST and is the only field that may contain a space (it
// comes from a file path); a layer name and a BCP-47 locale never do. So split
// on the first two spaces and keep the remainder whole.
const parseKey = (key: string): [layer: string, locale: string, ns: string] => {
    const a = key.indexOf(' ');
    const b = key.indexOf(' ', a + 1);
    return [key.slice(0, a), key.slice(a + 1, b), key.slice(b + 1)];
};

/**
 * The i18n store use-function. Call `useI18n()` inside a component (or via
 * `app.runWithContext`) to resolve the per-app/per-request instance.
 */
export const useI18n = defineStore('i18n', (ctx: SetupStoreContext) => {
    const config = resolveConfig();
    const formatter = config.formatter ?? lightweightFormatter;

    const { state, signals, patch } = ctx.defineState({
        locale: config.initialLocale ?? config.fallbackLocale,
        fallbackLocale: config.fallbackLocale,
        supported: config.supported ?? ([] as string[]),
        messages: {} as MessageTree
    });

    const events = ctx.defineEvents<{ localeChanged: { locale: string; prev: string } }>();

    // Namespaces requested so far (config-listed, plus per-consumer `ensureNamespace`
    // / `loadNamespace`). Each loads only on first use → per-surface payload split.
    const activeNamespaces = new Set<string>(config.namespaces ?? []);
    // Completed loads and in-flight loads, keyed (locale,ns) — dedupe + no refetch.
    const loaded = new Set<string>();
    const inflight = new Map<string, Promise<void>>();
    // Per-pair generation, bumped by `invalidate`. A load snapshots it and drops
    // its own result if it changed meanwhile — otherwise an orphaned in-flight
    // request would merge a stale catalog and re-mark the pair loaded, silently
    // undoing the invalidation.
    const keyGen = new Map<string, number>();
    // Pairs whose last load rejected, keyed (locale,ns), in failure order — the
    // newest entry is what `loadError` surfaces. Tracked per pair rather than as
    // one "last error" so that recoveries landing out of order can't leave
    // `loadError` pointing at a pair that has since succeeded. None of them are
    // in `loaded`, so `retry` and `invalidate` refetch them.
    //
    // The raw rejection values live here, OUTSIDE the reactive graph — a
    // rejection can be any exotic object (a DOMException, a class with getters)
    // and has no business being deep-proxied — with a plain version counter as
    // the reactive trigger.
    const failures = new Map<string, I18nLoadError>();
    const errorVersion = signal(0);
    function noteFailure(key: string, info: I18nLoadError): void {
        failures.delete(key); // re-insert so the newest failure sorts last
        failures.set(key, info);
        errorVersion.value++;
    }
    function clearFailure(key: string): void {
        if (failures.delete(key)) errorVersion.value++;
    }

    // ── Layers ───────────────────────────────────────────────────────────────
    // `layerTrees` is the source of truth and lives OUTSIDE reactive state,
    // alongside `loaded`/`inflight`/`failures`. `state.messages` holds the
    // EFFECTIVE view — one composed catalog per (locale, ns) — which is what
    // renders, what `lookup` reads, and what crosses the SSR boundary. Keeping
    // the wire shape as it always was is deliberate: the blob is uncompressed
    // JSON inlined in the HTML, copied once per island, and the client needs the
    // resolved strings, not the provenance.
    const layerOrder: readonly string[] = config.layers?.length ? config.layers : [BASE_LAYER];
    const defaultLayer = config.defaultLayer ?? layerOrder[0];
    const layerTrees: LayeredMessages = {};

    // Per-layer loaders; `load` is the loader for `defaultLayer`.
    const loaders: Record<string, LocaleLoader | undefined> = { ...config.loaders };
    if (config.load && !loaders[defaultLayer]) loaders[defaultLayer] = config.load;
    const hasAnyLoader = layerOrder.some(layer => loaders[layer]);

    /** Recompose the effective catalog for one pair. Single-layer returns by identity. */
    function recompose(locale: string, ns: string): void {
        const effective = composeAt(layerTrees, layerOrder, locale, ns);
        const tree = state.messages;
        if (!effective) {
            // No layer supplies this pair any more (e.g. `setLayer` dropped it and
            // nothing lower has it) — the effective view must not keep serving a
            // catalog that no longer has a source.
            if (tree[locale]) delete tree[locale][ns];
            return;
        }
        if (!tree[locale]) tree[locale] = {};
        tree[locale][ns] = effective;
    }

    /**
     * Write one catalog into one layer and refresh the effective view.
     *
     * The catalog is stored by reference and must be treated as IMMUTABLE —
     * composition is cached globally by catalog identity, so mutating one in
     * place would leave a stale composition. Replace it instead (`addMessages`
     * again, or `setLayer`).
     */
    function writeLayer(layer: string, locale: string, ns: string, catalog: Catalog): void {
        const tree = (layerTrees[layer] ??= {});
        if (!tree[locale]) tree[locale] = {};
        tree[locale][ns] = catalog;
        recompose(locale, ns);
        loaded.add(loadKey(layer, locale, ns));
    }

    // Seed SSR-preloaded catalogs synchronously so the render is synchronous
    // (no async boundaries → server/client VNode trees match) and every seeded
    // namespace is marked active + loaded (no client refetch).
    if (config.initialMessages) {
        for (const locale of Object.keys(config.initialMessages)) {
            for (const ns of Object.keys(config.initialMessages[locale])) {
                writeLayer(defaultLayer, locale, ns, config.initialMessages[locale][ns]);
                activeNamespaces.add(ns);
            }
        }
    }

    // Seed whole layers — the bulk form. Marked loaded for that layer only, so a
    // lower layer still fetches normally.
    if (config.layerMessages) {
        for (const layer of Object.keys(config.layerMessages)) {
            const tree = config.layerMessages[layer];
            for (const locale of Object.keys(tree)) {
                for (const ns of Object.keys(tree[locale])) {
                    writeLayer(layer, locale, ns, tree[locale][ns]);
                    activeNamespaces.add(ns);
                }
            }
        }
    }

    function loadOne(layer: string, locale: string, ns: string): Promise<void> {
        const key = loadKey(layer, locale, ns);
        if (loaded.has(key)) return Promise.resolve();
        const pending = inflight.get(key);
        if (pending) return pending;
        const loader = loaders[layer];
        if (!loader) return Promise.resolve();

        // Snapshot this pair's generation; a superseded load touches nothing.
        const gen = keyGen.get(key) ?? 0;
        const current = () => (keyGen.get(key) ?? 0) === gen;

        // Call the loader INSIDE the chain, so a synchronous throw (a guard
        // clause, a bad namespace) lands on the same `.catch` as a rejection.
        // `Promise.resolve(loader(...))` would let it escape before the promise
        // existed — and `useTranslation` calls `ensureNamespace` during setup,
        // so that throw would take the render down with it.
        const job = Promise.resolve()
            .then(() => loader(locale, ns))
            .then(mod => {
                if (!current()) return;
                const catalog: Catalog =
                    mod && typeof mod === 'object' && 'default' in mod
                        ? (mod as { default: Catalog }).default
                        : (mod as Catalog);
                writeLayer(layer, locale, ns, catalog);
                clearFailure(key); // recovered
            })
            .catch(err => {
                if (!current()) return;
                // A failed catalog load must never crash the app; fall back through
                // the resolution chain and allow a later retry (not marked loaded).
                noteFailure(key, { error: err, locale, namespace: ns });
                if (config.onLoadError) {
                    config.onLoadError(err, { locale, namespace: ns });
                } else if (__DEV__) {
                    console.error(`[@sigx/i18n] failed to load ${locale}/${ns}:`, err);
                } else {
                    console.error(err);
                }
            })
            .finally(() => {
                // Only the generation that owns the slot may clear it, or a
                // superseded job would evict the replacement load that follows it.
                if (current()) inflight.delete(key);
            });

        inflight.set(key, job);
        return job;
    }

    /**
     * Load a namespace for `locale` + the master locale (so fallback is
     * available), across every layer that has a loader.
     */
    function loadNamespaceFor(ns: string, locale: string): Promise<void> {
        if (!hasAnyLoader) return Promise.resolve();
        const jobs: Promise<void>[] = [];
        for (const layer of layerOrder) {
            jobs.push(loadOne(layer, locale, ns));
            if (locale !== config.fallbackLocale) jobs.push(loadOne(layer, config.fallbackLocale, ns));
        }
        return Promise.all(jobs).then(() => {});
    }

    /** Reload every active namespace for `locale` — used on locale switch. */
    function reloadActive(locale: string): Promise<void> {
        if (!hasAnyLoader || activeNamespaces.size === 0) return Promise.resolve();
        return Promise.all([...activeNamespaces].map(ns => loadNamespaceFor(ns, locale))).then(() => {});
    }

    const actions = ctx.defineActions({
        async setLocale(locale: string): Promise<void> {
            const next = matchLocale(locale, state.supported, state.fallbackLocale);
            if (next === state.locale) return;
            await reloadActive(next);
            const prev = state.locale;
            patch({ locale: next });
            events.localeChanged.publish({ locale: next, prev });
        },
        /** Idempotently load and merge one catalog; registers the namespace as active. */
        async loadNamespace(locale: string, ns: string): Promise<void> {
            activeNamespaces.add(ns);
            await loadNamespaceFor(ns, locale);
        },
        /**
         * Inject a catalog imperatively (tests, HMR, inline definitions, an
         * override fetched at runtime). With `layers` declared, name the layer to
         * override individual keys — every key the catalog omits still falls
         * through to the layer below:
         *
         * ```ts
         * store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });
         * ```
         *
         * Treat `catalog` as immutable once passed; replace it rather than
         * mutating it in place.
         */
        addMessages(locale: string, ns: string, catalog: Catalog, options?: { layer?: string }): void {
            activeNamespaces.add(ns);
            writeLayer(options?.layer ?? defaultLayer, locale, ns, catalog);
        },
        /**
         * Replace a whole layer in one call — the bulk form, for overrides held
         * in hand (one query returning every namespace for a tenant). Every pair
         * the layer previously supplied is recomposed, so removing a key from the
         * tree correctly falls back to the layer below.
         *
         * ```ts
         * store.setLayer('tenant', await db.loadOverrides());
         * ```
         */
        setLayer(layer: string, tree: MessageTree): void {
            // Supersede this layer's in-flight loads FIRST. A request already
            // running would otherwise resolve after the swap and call
            // `writeLayer` with what it fetched, quietly reinstating the tree
            // that was just replaced. `invalidate` guards the same way; bumping
            // the generation makes the orphaned job drop its own result.
            for (const key of new Set([...loaded, ...inflight.keys(), ...failures.keys()])) {
                if (parseKey(key)[0] !== layer) continue;
                keyGen.set(key, (keyGen.get(key) ?? 0) + 1);
                loaded.delete(key);
                inflight.delete(key);
            }

            const previous = layerTrees[layer];
            const touched = new Set<string>();
            if (previous) {
                for (const locale of Object.keys(previous)) {
                    for (const ns of Object.keys(previous[locale])) {
                        touched.add(loadKey(layer, locale, ns));
                    }
                }
            }
            layerTrees[layer] = {};
            for (const locale of Object.keys(tree)) {
                for (const ns of Object.keys(tree[locale])) {
                    writeLayer(layer, locale, ns, tree[locale][ns]);
                    activeNamespaces.add(ns);
                    touched.delete(loadKey(layer, locale, ns));
                }
            }
            // Pairs the layer used to supply but no longer does: recompose so the
            // lower layers show through again.
            for (const key of touched) {
                const [, locale, ns] = parseKey(key);
                recompose(locale, ns);
            }
        },
        /**
         * Drop cached catalogs and refetch the active ones — how a client picks
         * up a publish from a runtime-sourced catalog (a CMS, a form builder)
         * without a page reload. Narrow with `invalidate(locale)`,
         * `invalidate(locale, ns)` or `invalidate(locale, ns, layer)` — the last
         * refetches one layer and leaves the others cached; no arguments
         * invalidates everything.
         *
         * Stale-while-revalidate: the old catalogs stay in `messages` until the
         * refetch lands (`mergeCatalog` replaces a pair wholesale), so the UI
         * never flashes raw keys. No-op without a `load`, since nothing could
         * bring back what was dropped.
         */
        async invalidate(locale?: string, ns?: string, layer?: string): Promise<void> {
            if (!hasAnyLoader) return;
            // `failures` is in the candidate set too: a pair whose last load
            // rejected is in neither `loaded` nor `inflight`, and leaving it out
            // would make a transient failure unrecoverable by `invalidate` alone.
            const stale = [...new Set([...loaded, ...inflight.keys(), ...failures.keys()])]
                .map(parseKey)
                .filter(
                    ([lay, l, n]) =>
                        (locale === undefined || l === locale) &&
                        (ns === undefined || n === ns) &&
                        (layer === undefined || lay === layer)
                );

            for (const [lay, l, n] of stale) {
                const key = loadKey(lay, l, n);
                keyGen.set(key, (keyGen.get(key) ?? 0) + 1);
                loaded.delete(key);
                inflight.delete(key);
            }
            // Only refetch what something is actually using; an inactive
            // namespace reloads on its next `ensureNamespace`.
            await Promise.all(
                stale.filter(([, , n]) => activeNamespaces.has(n)).map(([lay, l, n]) => loadOne(lay, l, n))
            );
        },
        /** Retry every catalog load that failed. Drives a "translations unavailable" affordance. */
        async retry(): Promise<void> {
            const pairs = [...failures.keys()].map(parseKey);
            await Promise.all(pairs.map(([lay, l, n]) => loadOne(lay, l, n)));
        }
    });

    /**
     * Register a namespace as active and kick off its load for the current locale.
     * Reactive callers (the accessor, `<T>`, `use:t`) call this on first use, so a
     * namespace's JSON loads only when a component that uses it renders. Returns a
     * promise for the initial load (useful for SSR awaiting).
     */
    function ensureNamespace(ns: string): Promise<void> {
        const isNew = !activeNamespaces.has(ns);
        activeNamespaces.add(ns);
        return isNew ? loadNamespaceFor(ns, state.locale) : Promise.resolve();
    }

    // Missing-key handling: a key that resolves to nothing WHILE catalogs are
    // still loading is normal (the async window before the JSON arrives) — never
    // warn for it, or a first paint spams the console once per reactive read. We
    // only surface a genuinely missing key after loads settle, and only once.
    const warnedMissing = new Set<string>();
    const onMissing: TranslateConfig['onMissing'] = info => {
        if (config.onMissing) return config.onMissing(info);
        if (__DEV__ && inflight.size === 0) {
            const wk = `${info.locale} ${info.namespace} ${info.key}`;
            if (!warnedMissing.has(wk)) {
                warnedMissing.add(wk);
                console.warn(
                    `[@sigx/i18n] missing translation "${info.key}" ` +
                    `(ns=${info.namespace}, locale=${info.locale}).`
                );
            }
        }
        return info.key;
    };

    /**
     * Reactive translation. A plain method (NOT an action) so reads of
     * `state.locale`/`state.messages` happen in the caller's tracking scope and
     * make renders/computeds reactive.
     */
    function translateKey(namespace: string, key: string, params?: Params, options?: TranslateOptions): string {
        const tconfig: TranslateConfig = {
            fallbackLocale: state.fallbackLocale,
            localeFallbacks: config.localeFallbacks,
            formatter,
            onMissing
        };
        return translateWith(
            state.messages,
            key,
            params,
            { locale: state.locale, namespace },
            tconfig,
            options
        );
    }

    /**
     * Does `key` resolve anywhere in the locale chain? Reactive like
     * `translateKey`, and deliberately side-effect free — no `onMissing`, no
     * dev warning — so it can gate rendering on a runtime-sourced key.
     */
    function hasKey(namespace: string, key: string): boolean {
        return (
            lookup(
                state.messages,
                key,
                { locale: state.locale, namespace },
                { fallbackLocale: state.fallbackLocale, localeFallbacks: config.localeFallbacks }
            ) !== undefined
        );
    }

    /**
     * Which `(layer, locale)` supplies `key` — the answer to "why is this string
     * wrong", which gets genuinely hard to work out by inspection once there are
     * both a locale chain and a layer stack.
     *
     * Walks the locale chain outer, layers inner (high→low), mirroring exactly
     * how the value was resolved. Returns `null` when the key resolves nowhere.
     */
    function explain(namespace: string, key: string): { layer: string; locale: string } | null {
        for (const l of localeChain(state.locale, state.fallbackLocale, config.localeFallbacks)) {
            const layer = layerFor(layerTrees, layerOrder, l, namespace, key);
            if (layer) return { layer, locale: l };
        }
        return null;
    }

    const loading = computed(
        () =>
            actions.setLocale.pending ||
            actions.loadNamespace.pending ||
            actions.invalidate.pending ||
            actions.retry.pending
    );

    /** The newest STILL-FAILING catalog load, or `null`. Reactive. */
    const loadError = computed<I18nLoadError | null>(() => {
        void errorVersion.value; // the reactive trigger; the errors are held raw
        let newest: I18nLoadError | null = null;
        for (const info of failures.values()) newest = info;
        return newest;
    });

    // ── Init: detection → SSR seed → device persistence → catalog load ────────
    // Precedence increases down the list (each step overrides the previous):
    //   detection (lowest)  <  SSR server seed  <  device-persisted choice.
    // Detection runs first and unconditionally — on the SERVER it's the only
    // source (it reads the request), and on the client any SSR/persist value
    // layered on top simply overrides it.
    if (config.detect !== false) {
        const detected = detectLocale(
            createDetectors(config.detection),
            config.detection?.context ?? {},
            state.supported,
            state.fallbackLocale
        );
        if (detected !== state.locale) patch({ locale: detected });
    }

    const { ssrHydrated, persistHandle } =
        config.persistence === false
            ? { ssrHydrated: false, persistHandle: undefined }
            : installPersistSSR(ctx, { state, patch }, config.persistence ?? {});

    // Client hydration: the server already sent these catalogs via `ssrState`, so
    // mark them loaded — otherwise the initial reload below would re-fetch every
    // server-sent namespace (flash + wasted request).
    //
    // What crossed the wire is the EFFECTIVE view, already layered by the server,
    // so it seeds the lowest layer and only that layer counts as loaded. Any
    // higher layer still fetches normally. The consequence to know: for a
    // server-rendered string, `explain()` reports the base layer rather than the
    // layer the server actually resolved it from — provenance is not transferred,
    // because the client needs the resolved strings, not their history.
    if (ssrHydrated) {
        const baseLayer = layerOrder[0];
        const seeded = (layerTrees[baseLayer] ??= {});
        for (const locale of Object.keys(state.messages)) {
            if (!seeded[locale]) seeded[locale] = {};
            for (const ns of Object.keys(state.messages[locale])) {
                seeded[locale][ns] = state.messages[locale][ns];
                loaded.add(loadKey(baseLayer, locale, ns));
                activeNamespaces.add(ns);
            }
        }
    }

    // Load configured namespaces now (first paint), and again after device
    // hydration in case persist restored a different locale. Callers that need
    // catalogs resolved before use (e.g. SSR, before rendering) await `whenReady`
    // (and `ensureNamespace` for on-demand namespaces).
    void reloadActive(state.locale);
    const whenReady = Promise.resolve(persistHandle?.whenHydrated).then(() => reloadActive(state.locale));

    return {
        ...signals,
        ...actions,
        loading,
        loadError,
        localeChanged: events.localeChanged,
        translateKey,
        hasKey,
        explain,
        layers: layerOrder,
        ensureNamespace,
        whenReady,
        ssrHydrated,
        defaultNamespace: config.defaultNamespace ?? 'translation'
    };
}, 'scoped');

/** The resolved shape of a `useI18n()` instance. */
export type I18nStore = ReturnType<typeof useI18n>;
