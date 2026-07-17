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

// ── Nested typed accessor (derived from the generated Schema) ─────────────────

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never;

/** Flat dotted-key → params for a namespace, merged across every target that has it. */
type NamespaceKeyParams<NS extends string> = UnionToIntersection<
    {
        [T in keyof SchemaMessages]: NS extends keyof SchemaMessages[T] ? SchemaMessages[T][NS] : never;
    }[keyof SchemaMessages]
>;

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
 * (`t('cart.revenue', …)`) validates the key. Without codegen this degrades to
 * the permissive `Translator`.
 */
export type TypedTranslator<NS extends string> = SchemaMessages extends Record<string, unknown>
    ? Nested<NamespaceKeyParams<NS>> & { (key: KeysForNamespace<NS>, params?: Params): string }
    : Translator;

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
