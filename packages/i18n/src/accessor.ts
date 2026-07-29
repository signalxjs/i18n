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
import { useI18n, type I18nLoadError, type I18nStore, type TranslateOptions } from './store.js';

// ── Typed surface (populated by the @sigx/i18n/vite generated Schema) ─────────
// When the Vite plugin has generated types, `Schema` carries the real
// locales/namespaces/keys; otherwise every alias below degrades to a permissive
// `string`, so the runtime works with or without codegen.

type SchemaMessages = Schema extends { messages: infer M } ? M : unknown;

/** Known locales union (or `string` without codegen). */
export type KnownLocale = Schema extends { locales: infer L } ? L & string : string;
/** Known namespaces union (or `string` without codegen). */
export type KnownNamespace = Schema extends { namespaces: infer N } ? N & string : string;

/**
 * Namespaces the plugin was told are sourced at runtime (`runtimeNamespaces`).
 * They are real namespaces with no build-time catalog, so the namespace narrows
 * but the keys stay open. `never` without codegen, and for a `.d.ts` generated
 * before the option existed.
 */
type RuntimeNamespace = Schema extends { runtimeNamespaces: infer R } ? R & string : never;

/**
 * Dotted keys available in a namespace, or `string` without codegen.
 *
 * The runtime-namespace test is non-distributive (`[NS] extends [R]`) on
 * purpose. `useTranslation()` with no argument defaults `NS` to the whole
 * `KnownNamespace` union, and a distributive test would hand back `string` for
 * the runtime members — which then absorbs the whole union, silently switching
 * off key checking at every no-arg call site the moment *any* namespace is
 * declared runtime-sourced. Only a namespace that is exactly a runtime one gets
 * open keys; a union keeps the statically-known members' keys.
 */
export type KeysForNamespace<NS extends string> = SchemaMessages extends Record<string, unknown>
    ? [NS] extends [RuntimeNamespace]
        ? string
        : NS extends keyof SchemaMessages
          ? Extract<keyof SchemaMessages[NS], string>
          : never
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

// ── Nested typed accessor (derived from the generated Schema) ─────────────────

/** Flat dotted-key → params record for a namespace. */
type NamespaceKeyParams<NS extends string> = NS extends keyof SchemaMessages
    ? SchemaMessages[NS]
    : Record<string, never>;

/** A leaf: params required when the key has any, a plain no-arg call when it has none. */
type LeafFn<P> = keyof P extends never ? () => string : (params: P) => string;

/** First path segment of a dotted key. */
type Head<K extends string> = K extends `${infer H}.${string}` ? H : K;
/** Flat record of the keys nested under `H.` with the `H.` prefix stripped. */
type ChildKeys<F, H extends string> = {
    [K in keyof F as K extends `${H}.${infer R}` ? R : never]: F[K];
};

/**
 * Turn a flat dotted-key → params record into a nested accessor type: each
 * segment is a typed callable leaf and/or a nested group.
 */
type Nested<F> = {
    [H in Head<Extract<keyof F, string>>]: (H extends keyof F ? LeafFn<F[H]> : unknown) &
        ([Extract<keyof F, `${H}.${string}`>] extends [never] ? unknown : Nested<ChildKeys<F, H>>);
};

/**
 * A translator typed from the generated Schema: the nested accessor
 * (`t.cart.revenue({ amount })`) is fully typed per key, and the string-key form
 * (`t('cart.revenue', …)`) validates the key. Without codegen — or for a
 * `runtimeNamespaces` namespace, whose catalog does not exist at build time —
 * this degrades to the permissive `Translator`.
 */
export type TypedTranslator<NS extends string> = SchemaMessages extends Record<string, unknown>
    ? // Non-distributive, so a union NS doesn't split the return type.
      [NS] extends [RuntimeNamespace]
        ? Translator
        : Nested<NamespaceKeyParams<NS>> & { (key: KeysForNamespace<NS>, params?: Params): string }
    : Translator;

type TranslateFn = Pick<I18nStore, 'translateKey'>;
type DynamicFn = Pick<I18nStore, 'translateKey' | 'hasKey'>;

/**
 * Build a translator bound to a store + namespace.
 * Exposed for advanced use / SSR; components normally use `useTranslation`.
 */
export function createTranslator(store: TranslateFn, namespace: string): Translator {
    const resolve = (path: string[], params?: Params): string =>
        store.translateKey(namespace, path.join('.'), params);

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
            get(_target, prop) {
                if (typeof prop === 'symbol') {
                    // Coercion to string (`${}`, String(), attributes) resolves the
                    // key with no params — this powers the bare `t.a.b` form.
                    if (prop === Symbol.toPrimitive) return () => resolve(path);
                    // Never iterable/thenable: keeps the node from being mistaken
                    // for a children array or a promise by a renderer.
                    return undefined;
                }
                if (prop === 'toString' || prop === 'valueOf') return () => resolve(path);
                // Renderer/promise probes that must NOT mint a child node (else the
                // node is mistaken for a vnode). These are never valid as the FIRST
                // segment of a key; deeper segments (`t.user.name`) are unaffected.
                if (prop === 'then' || prop === '$$typeof' || prop === 'nodeType') return undefined;
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
    namespace?: NS
): TypedTranslator<NS> {
    const store = useI18n();
    const ns = namespace ?? store.defaultNamespace;
    void store.ensureNamespace(ns); // loads the namespace on first use
    return createTranslator(store, ns) as unknown as TypedTranslator<NS>;
}

// ── The dynamic (untyped-key) surface ────────────────────────────────────────
// Deliberately NOT a member of the `t` proxy. Every property of `t` is a message
// key, so a reserved `t.exists` would be a hole in the key space — and, once
// codegen has run, a type lie: a catalog with a key named `exists` would be
// typed as a translation leaf while the runtime handed back a boolean probe.
// A plain function object has no such conflict.

/**
 * Lookup for keys that don't exist at build time — CMS blocks, user-defined form
 * labels, admin-authored notification copy. The key is an open `string`, and
 * `default` supplies the author's original text so a missing translation renders
 * as real copy rather than a raw `block.a1b2c3.label`.
 */
export interface DynamicTranslator {
    (key: string, params?: Params, options?: TranslateOptions): string;
    /** Does this key resolve in the current locale chain? No warning, no `onMissing`. */
    exists(key: string): boolean;
}

/**
 * Build a dynamic translator bound to a store + namespace.
 * Exposed for advanced use / SSR; components normally use `useDynamicTranslation`.
 */
export function createDynamicTranslator(store: DynamicFn, namespace: string): DynamicTranslator {
    const t = (key: string, params?: Params, options?: TranslateOptions): string =>
        store.translateKey(namespace, key, params, options);
    t.exists = (key: string): boolean => store.hasKey(namespace, key);
    return t;
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
