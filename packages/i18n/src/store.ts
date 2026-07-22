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
import { computed } from '@sigx/reactivity';
import { defineStore, type SetupStoreContext } from '@sigx/store';
import { matchLocale, translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import { createDetectors, detectLocale, type DetectionOptions } from './detect.js';
import { installPersistSSR, type PersistSSROptions } from './persist-ssr.js';
import type { Catalog, Formatter, MessageTree, MissingInfo, Params, TranslateConfig } from './types.js';

/**
 * Loads one catalog for a `(locale, namespace)`. May return the catalog directly
 * or an ESM module with a `default`. Namespaces may be hierarchical (`admin/users`).
 */
export type LocaleLoader = (locale: string, namespace: string) => Promise<Catalog | { default: Catalog }>;

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

const loadKey = (l: string, ns: string) => `${l} ${ns}`;

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
        if (!config.load) return Promise.resolve();

        const job = Promise.resolve(config.load(locale, ns))
            .then(mod => {
                const catalog: Catalog =
                    mod && typeof mod === 'object' && 'default' in mod
                        ? (mod as { default: Catalog }).default
                        : (mod as Catalog);
                mergeCatalog(locale, ns, catalog);
            })
            .catch(err => {
                // A failed catalog load must never crash the app; fall back through
                // the resolution chain and allow a later retry (not marked loaded).
                if (__DEV__) {
                    console.error(`[@sigx/i18n] failed to load ${locale}/${ns}:`, err);
                } else {
                    console.error(err);
                }
            })
            .finally(() => {
                inflight.delete(key);
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
    function translateKey(namespace: string, key: string, params?: Params): string {
        const tconfig: TranslateConfig = {
            fallbackLocale: state.fallbackLocale,
            localeFallbacks: config.localeFallbacks,
            formatter,
            onMissing
        };
        return translate(state.messages, key, params, { locale: state.locale, namespace }, tconfig);
    }

    const loading = computed(() => actions.setLocale.pending || actions.loadNamespace.pending);

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
        localeChanged: events.localeChanged,
        translateKey,
        ensureNamespace,
        whenReady,
        ssrHydrated,
        defaultNamespace: config.defaultNamespace ?? 'translation'
    };
}, 'scoped');

/** The resolved shape of a `useI18n()` instance. */
export type I18nStore = ReturnType<typeof useI18n>;
