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

import type { Params, Schema } from './types.js';
import { useI18n, type I18nStore } from './store.js';

// ── Typed surface (populated by the @sigx/i18n/vite generated Schema) ─────────
// When the Vite plugin has generated types, `Schema` carries the real
// targets/locales/namespaces/keys; otherwise every alias below degrades to a
// permissive `string`, so the runtime works with or without codegen.

type SchemaMessages = Schema extends { messages: infer M } ? M : unknown;

/** Known locales union (or `string` without codegen). */
export type KnownLocale = Schema extends { locales: infer L } ? L & string : string;
/** Known targets union (or `string` without codegen). */
export type KnownTarget = Schema extends { targets: infer T } ? T & string : string;
/** Known namespaces union (or `string` without codegen). */
export type KnownNamespace = Schema extends { namespaces: infer N } ? N & string : string;

/** Dotted keys available in a namespace (union across targets), or `string`. */
export type KeysForNamespace<NS extends string> = SchemaMessages extends Record<string, unknown>
    ? {
          [T in keyof SchemaMessages]: NS extends keyof SchemaMessages[T]
              ? Extract<keyof SchemaMessages[T][NS], string>
              : never;
      }[keyof SchemaMessages]
    : string;

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

/**
 * A translator whose string-key form is typed to the namespace's real keys
 * (unknown keys are compile errors). The nested accessor (`t.a.b`) is
 * runtime-equivalent and stays structurally permissive.
 */
export interface TypedTranslator<NS extends string> {
    (key: KeysForNamespace<NS>, params?: Params): string;
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
 *
 * With `@sigx/i18n/vite` codegen, the namespace and the string-key form are typed
 * to the real catalog; without it, both accept any string.
 */
export function useTranslation<NS extends KnownNamespace = KnownNamespace>(
    namespace?: NS,
    options?: { target?: KnownTarget }
): TypedTranslator<NS> {
    const store = useI18n();
    const ns = namespace ?? store.defaultNamespace;
    void store.ensureNamespace(ns, options?.target); // load the requested target's catalogs
    return createTranslator(store, ns, options?.target) as unknown as TypedTranslator<NS>;
}

/** Reactive locale/target controls, resolved from the i18n store. */
export interface LocaleControls {
    /** The active locale (reactive). */
    readonly locale: KnownLocale;
    /** The active target/scope (reactive). */
    readonly target: KnownTarget;
    /** True while a locale/target/namespace load is in flight (reactive). */
    readonly loading: boolean;
    /** Switch locale (typed to the known locales with codegen). */
    setLocale: (locale: KnownLocale) => Promise<void>;
    /** Switch target/scope (typed to the known targets with codegen). */
    setTarget: (target: KnownTarget) => Promise<void>;
    /** Additively load a target's catalogs. */
    loadTarget: (target: KnownTarget) => Promise<void>;
    /** Resolves when the initial catalogs + device hydration have settled. */
    whenReady: Promise<void>;
}

/** Locale/target controls for switching UI. */
export function useLocale(): LocaleControls {
    const store = useI18n();
    return {
        get locale() {
            return store.locale as KnownLocale;
        },
        get target() {
            return store.target as KnownTarget;
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
