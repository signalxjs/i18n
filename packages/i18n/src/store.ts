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
import { lookup, matchLocale, translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import { createDetectors, detectLocale, type DetectionOptions } from './detect.js';
import { installPersistSSR, type PersistSSROptions } from './persist-ssr.js';
import type { Catalog, Formatter, MessageTree, MissingInfo, Params, TranslateConfig } from './types.js';

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

/** Per-call overrides for one `translateKey` lookup. */
export interface TranslateOptions {
    /**
     * Text to return when the key resolves in no locale — the author's original
     * string for a runtime-sourced message. Bypasses `onMissing` (and its
     * dev warning) entirely: an explicit call-site fallback means the miss is
     * expected, not a bug.
     */
    default?: string;
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
 * App-provided i18n config. Required (string-form injectable): resolving the
 * store without the `createI18n` plugin installed throws a structured DI error,
 * which is the intended failure mode.
 */
export const useI18nConfig = defineInjectable<I18nRuntimeConfig>('sigx:i18n:config');

const loadKey = (l: string, ns: string) => `${l} ${ns}`;
// Split on the FIRST space only: a BCP-47 locale never contains one, but a
// namespace comes from a file path and might.
const parseKey = (key: string): [locale: string, ns: string] => {
    const i = key.indexOf(' ');
    return [key.slice(0, i), key.slice(i + 1)];
};

/**
 * The i18n store use-function. Call `useI18n()` inside a component (or via
 * `app.runWithContext`) to resolve the per-app/per-request instance.
 */
export const useI18n = defineStore('i18n', (ctx: SetupStoreContext) => {
    const config = useI18nConfig();
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

    function mergeCatalog(locale: string, ns: string, catalog: Catalog): void {
        const tree = state.messages;
        if (!tree[locale]) tree[locale] = {};
        tree[locale][ns] = catalog;
        loaded.add(loadKey(locale, ns));
    }

    // Seed SSR-preloaded catalogs synchronously so the render is synchronous
    // (no async boundaries → server/client VNode trees match) and every seeded
    // namespace is marked active + loaded (no client refetch).
    if (config.initialMessages) {
        for (const locale of Object.keys(config.initialMessages)) {
            for (const ns of Object.keys(config.initialMessages[locale])) {
                mergeCatalog(locale, ns, config.initialMessages[locale][ns]);
                activeNamespaces.add(ns);
            }
        }
    }

    function loadOne(locale: string, ns: string): Promise<void> {
        const key = loadKey(locale, ns);
        if (loaded.has(key)) return Promise.resolve();
        const pending = inflight.get(key);
        if (pending) return pending;
        const loader = config.load;
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
                mergeCatalog(locale, ns, catalog);
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

    /** Load a namespace for `locale` + the master locale (so fallback is available). */
    function loadNamespaceFor(ns: string, locale: string): Promise<void> {
        if (!config.load) return Promise.resolve();
        const jobs = [loadOne(locale, ns)];
        if (locale !== config.fallbackLocale) jobs.push(loadOne(config.fallbackLocale, ns));
        return Promise.all(jobs).then(() => {});
    }

    /** Reload every active namespace for `locale` — used on locale switch. */
    function reloadActive(locale: string): Promise<void> {
        if (!config.load || activeNamespaces.size === 0) return Promise.resolve();
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
            await loadOne(locale, ns);
        },
        /** Inject a catalog imperatively (tests, HMR, inline definitions). */
        addMessages(locale: string, ns: string, catalog: Catalog): void {
            activeNamespaces.add(ns);
            mergeCatalog(locale, ns, catalog);
        },
        /**
         * Drop cached catalogs and refetch the active ones — how a client picks
         * up a publish from a runtime-sourced catalog (a CMS, a form builder)
         * without a page reload. Narrow with `invalidate(locale)` or
         * `invalidate(locale, ns)`; no arguments invalidates everything.
         *
         * Stale-while-revalidate: the old catalogs stay in `messages` until the
         * refetch lands (`mergeCatalog` replaces a pair wholesale), so the UI
         * never flashes raw keys. No-op without a `load`, since nothing could
         * bring back what was dropped.
         */
        async invalidate(locale?: string, ns?: string): Promise<void> {
            if (!config.load) return;
            // `failures` is in the candidate set too: a pair whose last load
            // rejected is in neither `loaded` nor `inflight`, and leaving it out
            // would make a transient failure unrecoverable by `invalidate` alone.
            const stale = [...new Set([...loaded, ...inflight.keys(), ...failures.keys()])]
                .map(parseKey)
                .filter(([l, n]) => (locale === undefined || l === locale) && (ns === undefined || n === ns));

            for (const [l, n] of stale) {
                const key = loadKey(l, n);
                keyGen.set(key, (keyGen.get(key) ?? 0) + 1);
                loaded.delete(key);
                inflight.delete(key);
            }
            // Only refetch what something is actually using; an inactive
            // namespace reloads on its next `ensureNamespace`.
            await Promise.all(stale.filter(([, n]) => activeNamespaces.has(n)).map(([l, n]) => loadOne(l, n)));
        },
        /** Retry every catalog load that failed. Drives a "translations unavailable" affordance. */
        async retry(): Promise<void> {
            const pairs = [...failures.keys()].map(parseKey);
            await Promise.all(pairs.map(([l, n]) => loadOne(l, n)));
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
        const fallback = options?.default;
        const tconfig: TranslateConfig = {
            fallbackLocale: state.fallbackLocale,
            localeFallbacks: config.localeFallbacks,
            formatter,
            // The default is the author's source text, so it gets the same
            // formatting a catalog string would — interpolation included, or a
            // CMS block authored as "Hi {name}" would render the token raw.
            // Only `onMissing` and its dev warning are skipped.
            onMissing:
                fallback === undefined
                    ? onMissing
                    : () => formatter.format(fallback, params, { locale: state.locale, key })
        };
        return translate(state.messages, key, params, { locale: state.locale, namespace }, tconfig);
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
    // mark them loaded (mirroring mergeCatalog) — otherwise the initial reload
    // below would re-fetch every server-sent namespace (flash + wasted request).
    if (ssrHydrated) {
        for (const locale of Object.keys(state.messages)) {
            for (const ns of Object.keys(state.messages[locale])) {
                loaded.add(loadKey(locale, ns));
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
        ensureNamespace,
        whenReady,
        ssrHydrated,
        defaultNamespace: config.defaultNamespace ?? 'translation'
    };
}, 'scoped');

/** The resolved shape of a `useI18n()` instance. */
export type I18nStore = ReturnType<typeof useI18n>;
