/**
 * The `useTranslation` proxy accessor — the headline UI DX.
 *
 * `const t = useTranslation('cart')` returns a `t` that is, all first-class:
 *   t('items', { count })     // string-key call — works with or without codegen
 *   t.summary.title           // bare accessor — coerces to the translated string
 *   t.items({ count })        // callable accessor — interpolation / plural params
 *   t.summary.title()         // nested key 'summary.title' (call form)
 *
 * One uniform proxy node per path segment: callable (apply → resolve key +
 * params), coercible (Symbol.toPrimitive/toString/valueOf → resolve, no params),
 * and indexable (property access → child node). Resolution reads the store's
 * reactive `locale`/`messages` through `translateKey`, so every form is reactive
 * when evaluated inside a render or `computed`.
 */

import type { Params } from './types.js';
import { useI18n, type I18nStore } from './store.js';

/** A nested accessor node: callable for params, indexable for deeper keys. */
export interface TranslatorNode {
    (params?: Params): string;
    [segment: string]: TranslatorNode;
}

/** The root translator: also callable in string-key form `t(key, params?)`. */
export interface Translator {
    (key: string, params?: Params): string;
    [segment: string]: TranslatorNode;
}

type TranslateFn = Pick<I18nStore, 'translateKey'>;

/**
 * Build a translator bound to a store + namespace (+ optional target override).
 * Exposed for advanced use / SSR; components normally use `useTranslation`.
 */
export function createTranslator(
    store: TranslateFn,
    namespace: string,
    targetOverride?: string
): Translator {
    const resolve = (path: string[], params?: Params): string =>
        store.translateKey(namespace, path.join('.'), params, targetOverride);

    const makeNode = (path: string[]): TranslatorNode => {
        // Target must be a function so the proxy's `apply` trap fires.
        const callable = (...args: unknown[]): string => {
            if (path.length === 0) {
                // Root string-key form: t(key, params?)
                return resolve([String(args[0] ?? '')], args[1] as Params | undefined);
            }
            // Accessor call form: t.a.b(params?)
            return resolve(path, args[0] as Params | undefined);
        };

        return new Proxy(callable, {
            get(target, prop, receiver) {
                if (typeof prop === 'symbol') {
                    // Coercion to string (JSX text, `${}`, String()) resolves the
                    // key with no params — this powers the bare `t.a.b` form.
                    if (prop === Symbol.toPrimitive) return () => resolve(path);
                    return Reflect.get(target, prop, receiver);
                }
                if (prop === 'toString' || prop === 'valueOf') return () => resolve(path);
                // Not a thenable — guard so `await`/Promise.resolve won't try to chain it.
                if (prop === 'then') return undefined;
                return makeNode([...path, prop]);
            }
        }) as unknown as TranslatorNode;
    };

    return makeNode([]) as unknown as Translator;
}

/**
 * Resolve the i18n store and return a translator for `namespace` (defaulting to
 * the configured default namespace). Registers the namespace as active and kicks
 * off its lazy load. Call inside a component setup (or `app.runWithContext`).
 */
export function useTranslation(namespace?: string, options?: { target?: string }): Translator {
    const store = useI18n();
    const ns = namespace ?? store.defaultNamespace;
    void store.ensureNamespace(ns);
    return createTranslator(store, ns, options?.target);
}

/** Reactive locale/target controls, resolved from the i18n store. */
export interface LocaleControls {
    /** The active locale (reactive). */
    readonly locale: string;
    /** The active target/scope (reactive). */
    readonly target: string;
    /** True while a locale/target/namespace load is in flight (reactive). */
    readonly loading: boolean;
    setLocale: I18nStore['setLocale'];
    setTarget: I18nStore['setTarget'];
    loadTarget: I18nStore['loadTarget'];
    /** Resolves when the initial catalogs + device hydration have settled. */
    whenReady: Promise<void>;
}

/** Locale/target controls for switching UI. */
export function useLocale(): LocaleControls {
    const store = useI18n();
    return {
        get locale() {
            return store.locale;
        },
        get target() {
            return store.target;
        },
        get loading() {
            return store.loading;
        },
        setLocale: store.setLocale,
        setTarget: store.setTarget,
        loadTarget: store.loadTarget,
        whenReady: store.whenReady
    };
}
