/**
 * The reactive i18n engine — a scoped `@sigx/store` so SSR gives one instance
 * per request (no module-global locale). Wraps the pure `translate` core with
 * reactive `locale` / `target` / `messages` state, lazy namespace loading, and
 * locale/target switch actions.
 *
 * Config is read from the `useI18nConfig` injectable, which the `createI18n`
 * plugin provides at app level (see `plugin.ts`). Detection, persistence and SSR
 * transfer are composed on top in `detect.ts` / `persist-ssr.ts`.
 */

import { defineInjectable } from '@sigx/runtime-core';
import { computed } from '@sigx/reactivity';
import { defineStore, type SetupStoreContext } from '@sigx/store';
import { matchLocale, targetChain, translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import { createDetectors, detectLocale, type DetectionOptions } from './detect.js';
import { installPersistSSR, type PersistSSROptions } from './persist-ssr.js';
import type {
    Catalog,
    Formatter,
    MessageTree,
    MissingInfo,
    Params,
    TargetDef,
    TranslateConfig
} from './types.js';

/** Loads one catalog. May return the catalog directly or an ESM module with a `default`. */
export type LocaleLoader = (
    target: string,
    locale: string,
    namespace: string
) => Promise<Catalog | { default: Catalog }>;

/** Fully-resolved runtime config consumed by the store (defaults already applied). */
export interface I18nRuntimeConfig {
    /** Master locale — source of truth for which keys exist. */
    fallbackLocale: string;
    /** Locale to start on before detection (defaults to `fallbackLocale`). */
    initialLocale?: string;
    /** Negotiation target set; empty/undefined accepts any locale. */
    supported?: string[];
    /** Active target/scope (API-defined name; defaults to the single `''` scope). */
    target?: string;
    /** Target graph with `extends` inheritance. */
    targets?: Record<string, TargetDef>;
    /** Explicit locale fallbacks layered on BCP-47 truncation. */
    localeFallbacks?: Record<string, string>;
    /** Message formatter (defaults to `lightweightFormatter`). */
    formatter?: Formatter;
    /** Namespaces always loaded up front. */
    namespaces?: string[];
    /** Namespace used when `useTranslation()` is called without one. Default `'translation'`. */
    defaultNamespace?: string;
    /** Catalog loader; when absent, catalogs must be supplied via `addMessages`. */
    load?: LocaleLoader;
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
 * App-provided i18n config. Required (string-form injectable): resolving the
 * store without the `createI18n` plugin installed throws a structured DI error,
 * which is the intended failure mode.
 */
export const useI18nConfig = defineInjectable<I18nRuntimeConfig>('sigx:i18n:config');

const loadKey = (t: string, l: string, ns: string) => `${t} ${l} ${ns}`;

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
        target: config.target ?? '',
        messages: {} as MessageTree
    });

    const events = ctx.defineEvents<{ localeChanged: { locale: string; prev: string } }>();

    // Active `(target, namespace)` scopes requested so far (config namespaces on
    // the default target, plus per-consumer `ensureNamespace`/`loadNamespace`).
    // Keyed by `${target}\0${ns}` so MANY targets can be loaded and rendered
    // concurrently — `state.target` is only the DEFAULT for un-targeted reads.
    const activeScopes = new Set<string>();
    const scopeKey = (target: string, ns: string) => `${target} ${ns}`;
    const activeNamespaceSet = () => new Set([...activeScopes].map(k => k.split(' ')[1]));
    for (const ns of config.namespaces ?? []) activeScopes.add(scopeKey(config.target ?? '', ns));

    // Completed loads and in-flight loads, keyed (target,locale,ns) — dedupe + no refetch.
    const loaded = new Set<string>();
    const inflight = new Map<string, Promise<void>>();

    function mergeCatalog(target: string, locale: string, ns: string, catalog: Catalog): void {
        const tree = state.messages;
        if (!tree[target]) tree[target] = {};
        if (!tree[target][locale]) tree[target][locale] = {};
        tree[target][locale][ns] = catalog;
        loaded.add(loadKey(target, locale, ns));
    }

    function loadOne(target: string, locale: string, ns: string): Promise<void> {
        const key = loadKey(target, locale, ns);
        if (loaded.has(key)) return Promise.resolve();
        const pending = inflight.get(key);
        if (pending) return pending;
        if (!config.load) return Promise.resolve();

        const job = Promise.resolve(config.load(target, locale, ns))
            .then(mod => {
                const catalog: Catalog =
                    mod && typeof mod === 'object' && 'default' in mod
                        ? (mod as { default: Catalog }).default
                        : (mod as Catalog);
                mergeCatalog(target, locale, ns, catalog);
            })
            .catch(err => {
                // A failed catalog load must never crash the app; fall back through
                // the resolution chain and allow a later retry (not marked loaded).
                if (__DEV__) {
                    console.error(`[@sigx/i18n] failed to load ${target}/${locale}/${ns}:`, err);
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

    /** Load one `(target, ns)` scope for `locale` + master across the target's `extends` chain. */
    function loadScope(target: string, ns: string, locale: string): Promise<void> {
        if (!config.load) return Promise.resolve();
        const jobs: Promise<void>[] = [];
        for (const t of targetChain(target, config.targets)) {
            jobs.push(loadOne(t, locale, ns));
            if (locale !== config.fallbackLocale) jobs.push(loadOne(t, config.fallbackLocale, ns));
        }
        return Promise.all(jobs).then(() => {});
    }

    /** Register + load a `(target, ns)` scope at the current locale. */
    function ensureScope(target: string, ns: string): Promise<void> {
        const key = scopeKey(target, ns);
        const isNew = !activeScopes.has(key);
        activeScopes.add(key);
        return isNew ? loadScope(target, ns, state.locale) : Promise.resolve();
    }

    /** Reload every active `(target, ns)` scope for `locale` — used on locale switch. */
    function reloadActive(locale: string): Promise<void> {
        if (!config.load || activeScopes.size === 0) return Promise.resolve();
        const jobs: Promise<void>[] = [];
        for (const key of activeScopes) {
            const [target, ns] = key.split(' ');
            jobs.push(loadScope(target, ns, locale));
        }
        return Promise.all(jobs).then(() => {});
    }

    const actions = ctx.defineActions({
        async setLocale(locale: string): Promise<void> {
            const next = matchLocale(locale, state.supported, state.fallbackLocale);
            if (next === state.locale) return;
            await reloadActive(next); // every active target's catalogs, not just the default
            const prev = state.locale;
            patch({ locale: next });
            events.localeChanged.publish({ locale: next, prev });
        },
        /** Switch the DEFAULT target; loads its catalogs for every active namespace. */
        async setTarget(target: string): Promise<void> {
            if (target === state.target) return;
            await Promise.all([...activeNamespaceSet()].map(ns => ensureScope(target, ns)));
            patch({ target });
        },
        /** Additively load a target's active namespaces without switching to it. */
        async loadTarget(target: string): Promise<void> {
            await Promise.all([...activeNamespaceSet()].map(ns => ensureScope(target, ns)));
        },
        /** Idempotently load and merge one catalog; registers the (target, ns) scope. */
        async loadNamespace(target: string, locale: string, ns: string): Promise<void> {
            activeScopes.add(scopeKey(target, ns));
            await loadOne(target, locale, ns);
        },
        /** Inject a catalog imperatively (tests, HMR, inline definitions). */
        addMessages(target: string, locale: string, ns: string, catalog: Catalog): void {
            activeScopes.add(scopeKey(target, ns));
            mergeCatalog(target, locale, ns, catalog);
        }
    });

    /**
     * Register a `(target, ns)` scope as active and kick off its load for the
     * current locale. Reactive callers (the accessor, `<T>`, `use:t`) call this on
     * first use, passing the target they read from so MANY targets load
     * concurrently. Returns a promise for the initial load (useful for SSR).
     */
    function ensureNamespace(ns: string, target: string = state.target): Promise<void> {
        return ensureScope(target, ns);
    }

    // Missing-key handling: a key that resolves to nothing WHILE catalogs are
    // still loading is normal (the async window before the JSON arrives) — never
    // warn for it, or a first paint spams the console once per reactive read. We
    // only surface a genuinely missing key after loads settle, and only once.
    const warnedMissing = new Set<string>();
    const onMissing: TranslateConfig['onMissing'] = info => {
        if (config.onMissing) return config.onMissing(info);
        if (__DEV__ && inflight.size === 0) {
            const wk = `${info.target} ${info.locale} ${info.namespace} ${info.key}`;
            if (!warnedMissing.has(wk)) {
                warnedMissing.add(wk);
                console.warn(
                    `[@sigx/i18n] missing translation "${info.key}" ` +
                    `(ns=${info.namespace}, locale=${info.locale}, target=${info.target || 'default'}).`
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
    function translateKey(
        namespace: string,
        key: string,
        params?: Params,
        targetOverride?: string
    ): string {
        const tconfig: TranslateConfig = {
            fallbackLocale: state.fallbackLocale,
            localeFallbacks: config.localeFallbacks,
            targets: config.targets,
            formatter,
            onMissing
        };
        return translate(
            state.messages,
            key,
            params,
            { target: targetOverride ?? state.target, locale: state.locale, namespace },
            tconfig
        );
    }

    const loading = computed(
        () =>
            actions.setLocale.pending ||
            actions.setTarget.pending ||
            actions.loadTarget.pending ||
            actions.loadNamespace.pending
    );

    // ── Init: detection → SSR seed → device persistence → catalog load ────────
    // Precedence increases down the list (each step overrides the previous):
    //   detection (lowest)  <  SSR server seed  <  device-persisted choice.
    // Detection runs first and unconditionally — on the SERVER it's the only
    // source (it reads the request), and on the client any SSR/persist value
    // layered on top simply overrides it.

    // 1) Detection: server reads the request context; client reads navigator/
    //    cookie/url.
    if (config.detect !== false) {
        const detected = detectLocale(
            createDetectors(config.detection),
            config.detection?.context ?? {},
            state.supported,
            state.fallbackLocale
        );
        if (detected !== state.locale) patch({ locale: detected });
    }

    // 2) SSR seed (client, sync) then device persistence (possibly async) — each
    //    overrides the prior locale when present.
    const { ssrHydrated, persistHandle } =
        config.persistence === false
            ? { ssrHydrated: false, persistHandle: undefined }
            : installPersistSSR(ctx, { state, patch }, config.persistence ?? {});

    // 3) Load configured namespaces now (first paint), and again after device
    //    hydration in case persist restored a different locale.
    void reloadActive(state.locale);
    const whenReady = Promise.resolve(persistHandle?.whenHydrated).then(() =>
        reloadActive(state.locale)
    );

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
