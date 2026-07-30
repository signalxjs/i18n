/**
 * The client hooks — `useTranslation`, `useDynamicTranslation`, `useLocale`.
 *
 * This is the thin DI layer: it resolves the reactive store and hands it to the
 * shared factories in `translator.ts`, which is also what `@sigx/i18n/server`
 * uses. The translator shapes, the `Schema`-derived types and the proxy live
 * there — so client and server produce the *same* translator, and this module is
 * the only part of that path that knows sigx exists.
 *
 * `const t = useTranslation('cart')` returns a `t` that is, all first-class:
 *   t('items', { count })     // string-key call — works with or without codegen
 *   t.summary.title           // bare accessor — coerces to the translated string
 *   t.items({ count })        // callable accessor — interpolation / plural params
 *   t.summary.title()         // nested key 'summary.title' (call form)
 *
 * Resolution reads the store's reactive `locale`/`messages` through
 * `translateKey`, so every form is reactive inside a render or `computed`.
 *
 * ## Under `@sigx/resume`
 *
 * `t` is a **setup helper**, which decides what a resumed handler may capture.
 * Reading it in the RENDER is free — that is how the server HTML is produced:
 *
 * ```tsx
 * const count = ctx.signal(0);
 * // ✅ the handler captures only the named signal → extracts to a QRL chunk
 * return () => <button onClick={() => count.value++}>{t.label({ count: count.value })}</button>;
 * ```
 *
 * CAPTURING it in a handler does not extract: the whole component falls back to
 * wake-on-interaction, with a build-time warning naming the capture.
 *
 * ```tsx
 * // ❌ `t` is a setup helper — not expressible through the resumed scope
 * <button onClick={() => (msg.value = t.saved())}>save</button>
 * ```
 *
 * Translate in the render, or pass the translated string in as a prop. When a
 * boundary genuinely must re-translate in the browser (a plural of a live
 * count), it needs config with no app present — see `provideI18nConfig`.
 */

import { useI18n, type I18nLoadError } from './store.js';
import {
    createDynamicTranslator,
    createTranslator,
    type DynamicTranslator,
    type KnownLocale,
    type KnownNamespace,
    type TypedTranslator
} from './translator.js';

/**
 * Resolve the i18n store and return a translator for `namespace` (defaulting to
 * the configured default namespace). Registers the namespace as active and kicks
 * off its lazy load. Call inside a component setup (or `app.runWithContext`).
 *
 * With `@sigx/i18n/vite` codegen, the namespace and the string-key form are typed
 * to the real catalog; without it, both accept any string.
 */
export function useTranslation<NS extends KnownNamespace = KnownNamespace>(
    namespace?: NS
): TypedTranslator<NS> {
    const store = useI18n();
    const ns = namespace ?? store.defaultNamespace;
    void store.ensureNamespace(ns); // loads the namespace on first use
    return createTranslator(store, ns) as unknown as TypedTranslator<NS>;
}

/**
 * Resolve the i18n store and return a {@link DynamicTranslator} for `namespace`.
 * The namespace is still checked against the generated Schema; only the keys are
 * open. Use it for runtime-sourced messages; `useTranslation` stays the typed
 * path for the app's own chrome.
 *
 * ```ts
 * const content = useDynamicTranslation('content');
 * content(block.labelKey, { count }, { default: block.label });
 * if (content.exists(block.helpKey)) …
 * ```
 */
export function useDynamicTranslation<NS extends KnownNamespace = KnownNamespace>(
    namespace?: NS
): DynamicTranslator {
    const store = useI18n();
    const ns = namespace ?? store.defaultNamespace;
    void store.ensureNamespace(ns); // loads the namespace on first use
    return createDynamicTranslator(store, ns);
}

/** Reactive locale controls, resolved from the i18n store. */
export interface LocaleControls {
    /** The active locale (reactive). */
    readonly locale: KnownLocale;
    /** True while a locale/namespace load is in flight (reactive). */
    readonly loading: boolean;
    /**
     * The most recent catalog-load failure, or `null` (reactive). Pair with
     * `retry` to drive a "translations unavailable" affordance — a bundled
     * `import()` failing is a broken build, but a `fetch` failing is Tuesday.
     */
    readonly error: I18nLoadError | null;
    /** Switch locale (typed to the known locales with codegen). */
    setLocale: (locale: KnownLocale) => Promise<void>;
    /** Retry every catalog load that failed. */
    retry: () => Promise<void>;
    /** Resolves when the initial catalogs + device hydration have settled. */
    whenReady: Promise<void>;
}

/** Locale controls for switching UI. */
export function useLocale(): LocaleControls {
    const store = useI18n();
    return {
        get locale() {
            return store.locale as KnownLocale;
        },
        get loading() {
            return store.loading;
        },
        get error() {
            return store.loadError;
        },
        setLocale: store.setLocale,
        retry: store.retry,
        whenReady: store.whenReady
    };
}
