/**
 * The translator surface — shared verbatim by the reactive client store and the
 * DI-free server translator.
 *
 * This module is deliberately free of sigx: no store, no signals, no DI, no
 * `node:`. Everything it needs from whatever backs it arrives through
 * {@link TranslationSource}, so `@sigx/i18n/server` can build the *same* typed
 * translator over an in-memory catalog tree that `useTranslation` builds over
 * the reactive store. A mail template therefore gets the same literal key union
 * and the same build gate as the UI. `__tests__/edge-clean.test.ts` pins the
 * sigx-free property.
 *
 * Two translator shapes, and the reason there are two:
 *
 *  - {@link createTranslator} returns a **proxy** whose every property is a
 *    message key — that is what powers `t.cart.title` and the per-key typing.
 *    It follows that it can carry no methods of its own: a reserved `t.exists`
 *    would be a hole in the key space, and once codegen has run, a type lie (a
 *    catalog key named `exists` would type as a translation leaf while the
 *    runtime handed back a boolean).
 *  - {@link createDynamicTranslator} returns a plain function object for keys
 *    that do not exist at build time. No proxy, so `.exists` is a real property.
 *
 * One rule for the per-call `default`: it is available wherever keys are **open**
 * (`Translator`, `DynamicTranslator`) and nowhere else. A typed key is
 * guaranteed by the completeness gate to exist in the master catalog, so a
 * call-site fallback for it would be dead code.
 */

import type { Params, Schema, TranslateOptions } from './types.js';

/**
 * What a translator needs from whatever backs it. The reactive store satisfies
 * this structurally; the server builds one over a catalog tree. Keeping it an
 * interface — rather than `Pick<I18nStore, …>` — is what lets this module stay
 * sigx-free.
 */
export interface TranslationSource {
    translateKey(namespace: string, key: string, params?: Params, options?: TranslateOptions): string;
    hasKey(namespace: string, key: string): boolean;
}

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
    (params?: Params, options?: TranslateOptions): string;
    [segment: string]: TranslatorNode;
}

/**
 * The root translator with OPEN keys — what you get without codegen, and for a
 * `runtimeNamespaces` namespace. Because the keys are open, the call form also
 * takes a per-call `default`.
 */
export interface Translator {
    (key: string, params?: Params, options?: TranslateOptions): string;
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
 * this degrades to the permissive `Translator`, which is also where the per-call
 * `default` lives.
 */
export type TypedTranslator<NS extends string> = SchemaMessages extends Record<string, unknown>
    ? // Non-distributive, so a union NS doesn't split the return type.
      [NS] extends [RuntimeNamespace]
        ? Translator
        : Nested<NamespaceKeyParams<NS>> & { (key: KeysForNamespace<NS>, params?: Params): string }
    : Translator;

/**
 * Build a translator bound to a source + namespace — the proxy behind
 * `useTranslation` (client) and `.forNamespace()` (server).
 *
 * One uniform node per path segment: callable (apply → resolve key + params),
 * coercible (`Symbol.toPrimitive`/`toString`/`valueOf` → resolve, no params),
 * and indexable (property access → child node). On the client the source reads
 * reactive state, so every form is reactive inside a render or `computed`.
 */
export function createTranslator(source: TranslationSource, namespace: string): Translator {
    const resolve = (path: string[], params?: Params, options?: TranslateOptions): string =>
        source.translateKey(namespace, path.join('.'), params, options);

    const makeNode = (path: string[]): TranslatorNode => {
        // Target must be a function so the proxy's `apply` trap fires.
        const callable = (...args: unknown[]): string => {
            if (path.length === 0) {
                // Root string-key form: t(key, params?, options?)
                return resolve(
                    [String(args[0] ?? '')],
                    args[1] as Params | undefined,
                    args[2] as TranslateOptions | undefined
                );
            }
            // Accessor call form: t.a.b(params?, options?)
            return resolve(path, args[0] as Params | undefined, args[1] as TranslateOptions | undefined);
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
 * Build a dynamic translator bound to a source + namespace — behind
 * `useDynamicTranslation` (client) and `.dynamic()` (server). A plain function
 * object, NOT a proxy, which is what lets `.exists` be a real property without
 * shadowing a message key.
 */
export function createDynamicTranslator(source: TranslationSource, namespace: string): DynamicTranslator {
    const t = (key: string, params?: Params, options?: TranslateOptions): string =>
        source.translateKey(namespace, key, params, options);
    t.exists = (key: string): boolean => source.hasKey(namespace, key);
    return t;
}

// ── A translator bound to one locale ─────────────────────────────────────────

/** Per-call namespace override for a locale-bound translator's open-key calls. */
export interface BoundTranslateOptions extends TranslateOptions {
    namespace?: KnownNamespace;
}

/**
 * A translator pinned to one locale. Both entries produce exactly this:
 * `createServerT().forLocale(l)` on the server, `useI18n().forLocale(l)` on the
 * client — so a preview pane and a mail template are the same three lines.
 * Binding a namespace on top of it is what yields the typed proxy:
 *
 * | | client | server |
 * |---|---|---|
 * | typed, namespace-bound | `forNamespace(ns)` / `useTranslation(ns, { locale })` | `forNamespace(ns)` |
 * | open-key, namespace-bound | `dynamic(ns)` / `useDynamicTranslation(ns, { locale })` | `dynamic(ns)` |
 */
export interface BoundTranslator {
    /** The locale this translator is bound to. */
    readonly locale: string;
    /** Open-key call. Keys are `string` because no namespace is statically bound. */
    t(key: string, params?: Params, options?: BoundTranslateOptions): string;
    /** Does the key resolve? No `onMissing`, no dev warning. */
    exists(key: string, options?: { namespace?: KnownNamespace }): boolean;
    /** Bind a namespace → the typed proxy (`m.subject()`, `m('subject')`, `` `${m.subject}` ``). */
    forNamespace<NS extends KnownNamespace = KnownNamespace>(namespace?: NS): TypedTranslator<NS>;
    /** Bind a namespace → open keys, with a call-site `default` and `exists`. */
    dynamic<NS extends KnownNamespace = KnownNamespace>(namespace?: NS): DynamicTranslator;
}

/**
 * Build a {@link BoundTranslator} over an already locale-bound {@link TranslationSource}.
 * Shared by `createServerT` and the reactive store, so the two surfaces cannot drift.
 *
 * `onUse` is the client's seam: it receives the resolved namespace of every call,
 * which is how a pinned translator kicks off the catalog load for *its* locale.
 * The server has no loading and passes nothing.
 */
export function bindLocale(
    source: TranslationSource,
    locale: string,
    defaultNamespace: string,
    onUse?: (namespace: string) => void
): BoundTranslator {
    const resolveNs = (namespace: string | undefined): string => {
        const ns = namespace ?? defaultNamespace;
        onUse?.(ns);
        return ns;
    };
    return {
        locale,
        t: (key, params, options) =>
            source.translateKey(resolveNs(options?.namespace), key, params, options),
        exists: (key, options) => source.hasKey(resolveNs(options?.namespace), key),
        forNamespace: <NS extends KnownNamespace = KnownNamespace>(namespace?: NS) =>
            createTranslator(source, resolveNs(namespace)) as unknown as TypedTranslator<NS>,
        dynamic: (namespace?: string) => createDynamicTranslator(source, resolveNs(namespace))
    };
}
