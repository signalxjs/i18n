/**
 * @sigx/i18n/server — a non-reactive, DI-free translator for server-only
 * localization: mail templates, queue jobs, API responses, PDFs.
 *
 * It reuses the exact same pure `translate` core (master fallback, locale chain),
 * the same formatter, AND the same translator surface as the client — the proxy
 * behind `useTranslation` is built here too, over a catalog tree instead of the
 * reactive store (see `translator.ts` and its `TranslationSource`). So a mail
 * template gets the literal key union and the completeness gate that the UI
 * gets: rename a key in `mail.json` and the build fails, rather than the email.
 *
 * It still has zero dependency on sigx — no store, no signals, no app — so it
 * runs in a mailer worker with nothing else wired up. `edge-clean.test.ts` pins
 * that, and the `dist/server.js` size budget would blow if sigx crept in.
 *
 * **This entry is universal**: no `node:` imports, so it runs unchanged on
 * workerd, Deno, Bun and inside a bundled edge build (the deploy adapters'
 * server builds forbid `node:` specifiers). Catalogs arrive as data — from
 * `virtual:sigx-i18n/server-catalogs` (emitted by `@sigx/i18n/vite`, the edge
 * path) or from `loadCatalogs()` in `@sigx/i18n/server/node` (the fs path).
 *
 * Server-only namespaces are simply files the client loader's glob never sees;
 * declare them as `serverOnly` on the Vite plugin to keep them out of the
 * client catalog tree entirely. They still reach the generated `Schema`, so
 * they are typed here.
 */

import { lookup, translateWith } from './translate.js';
import { BASE_LAYER, composeAt, type LayeredMessages } from './layers.js';
import { lightweightFormatter } from './formatter.js';
import { resolveRequestLocale, type DetectionOptions, type RequestLike } from './detect.js';
import {
    createDynamicTranslator,
    createTranslator,
    type DynamicTranslator,
    type KnownNamespace,
    type TranslationSource,
    type TypedTranslator
} from './translator.js';
import type {
    Catalog,
    Formatter,
    MessageTree,
    MissingInfo,
    Params,
    TranslateConfig,
    TranslateOptions
} from './types.js';

export interface ServerI18nOptions {
    /** The catalog tree: `catalogs[locale][namespace]`. Seeds the lowest layer. */
    catalogs: MessageTree;
    /**
     * Ordered override layers, lowest priority first — the same axis the client
     * store has, so a tenant-overridden string is identical in a mail template
     * and in the UI. Omit for single-source behaviour.
     */
    layers?: string[];
    /**
     * Seed whole layers at construction: `layerCatalogs[layer][locale][namespace]`.
     *
     * `catalogs` fills the lowest layer unconditionally, so name a **higher**
     * layer here — an entry for the lowest one is ignored (with a dev warning).
     * For a layer that varies per request, use {@link LocaleTranslator.withLayers}.
     */
    layerCatalogs?: LayeredMessages;
    /** Master locale, used when a key is untranslated. */
    fallbackLocale: string;
    /** Default namespace when a call omits one. Default `'translation'`. */
    defaultNamespace?: string;
    /** Explicit locale fallbacks layered on BCP-47 truncation. */
    localeFallbacks?: Record<string, string>;
    /** Message formatter (defaults to `lightweightFormatter`). */
    formatter?: Formatter;
    /** Missing-key handler. */
    onMissing?: (info: MissingInfo) => string;
}

/**
 * Per-call overrides for an open-key server call: where to look, plus the
 * author's fallback text. One bag rather than a separate scope and options
 * argument — the client's `TranslateOptions` with the locale/namespace the
 * server has to carry because it has no ambient locale state.
 */
export interface ServerTranslateOptions extends TranslateOptions {
    /**
     * Deliberately `string`, not `KnownLocale`: a server locale is negotiated
     * from a request at runtime (`resolveRequestLocale` returns `string`), so
     * narrowing it would force a cast on the normal path. The *namespace* below
     * comes from source code, so it is checked.
     */
    locale?: string;
    namespace?: KnownNamespace;
}

/**
 * A translator bound to one locale — what `createServerT().forLocale()` and a
 * bound request BOTH produce. Binding a namespace on top of it is what yields
 * the typed proxy, mirroring the client exactly:
 *
 * | | client | server |
 * |---|---|---|
 * | typed, namespace-bound | `useTranslation(ns)` | `.forNamespace(ns)` |
 * | open-key, namespace-bound | `useDynamicTranslation(ns)` | `.dynamic(ns)` |
 */
export interface LocaleTranslator {
    /** The locale this translator is bound to. */
    readonly locale: string;
    /** Open-key call. Keys are `string` because no namespace is statically bound. */
    t(key: string, params?: Params, options?: Omit<ServerTranslateOptions, 'locale'>): string;
    /** Does the key resolve? No `onMissing`, no dev warning. */
    exists(key: string, options?: { namespace?: KnownNamespace }): boolean;
    /** Bind a namespace → the typed proxy (`m.subject()`, `m('subject')`, `` `${m.subject}` ``). */
    forNamespace<NS extends KnownNamespace = KnownNamespace>(namespace?: NS): TypedTranslator<NS>;
    /** Bind a namespace → open keys, with a call-site `default` and `exists`. */
    dynamic<NS extends KnownNamespace = KnownNamespace>(namespace?: NS): DynamicTranslator;
    /**
     * Layer extra catalogs on top, returning a new translator — the per-request
     * form. `createRequestT` builds once outside the request and the request only
     * picks a locale, so this is what makes a per-tenant override expressible:
     *
     * ```ts
     * const m = requestT(rq.request)
     *     .withLayers({ tenant: await db.overridesFor(rq.tenantId) })
     *     .forNamespace('mail');
     * ```
     *
     * The receiver is not modified, so one `createRequestT` safely serves many
     * tenants. Composition is cached globally by catalog identity, so a tenant
     * seen before costs a tree walk rather than a re-merge.
     */
    withLayers(trees: LayeredMessages): LocaleTranslator;
}

export interface ServerTranslator {
    /** The message tree (locale → namespace → catalog), for inspection. */
    readonly messages: MessageTree;
    /** One-off call. `options.locale` defaults to the master locale. */
    t(key: string, params?: Params, options?: ServerTranslateOptions): string;
    /** One-off existence probe. */
    exists(key: string, options?: { locale?: string; namespace?: KnownNamespace }): boolean;
    /** Bind a locale. Everything else hangs off the result. */
    forLocale(locale: string): LocaleTranslator;
}

/**
 * Create a server translator over an in-memory catalog tree.
 *
 * ```ts
 * import catalogs from 'virtual:sigx-i18n/server-catalogs';
 * const t = createServerT({ catalogs, fallbackLocale: 'en', defaultNamespace: 'mail' });
 *
 * const m = t.forLocale('sv').forNamespace('mail');
 * m.subject();               // typed against the generated Schema
 * m.welcome({ name: 'Åsa' });
 * ```
 */
export function createServerT(options: ServerI18nOptions): ServerTranslator {
    const {
        catalogs,
        fallbackLocale,
        defaultNamespace = 'translation',
        localeFallbacks,
        formatter = lightweightFormatter,
        onMissing
    } = options;

    const tconfig: TranslateConfig = { fallbackLocale, localeFallbacks, formatter, onMissing };

    const layerOrder: readonly string[] = options.layers?.length ? options.layers : [BASE_LAYER];
    const rootLayers: LayeredMessages = { ...options.layerCatalogs };
    // `catalogs` is required and IS the lowest layer, so it wins that slot
    // unconditionally — a `??=` here would let a `layerCatalogs` entry silently
    // discard a required argument. Naming the lowest layer in `layerCatalogs` is
    // therefore a mistake, and a loud one rather than a silent one.
    if (__DEV__ && options.layerCatalogs && layerOrder[0] in options.layerCatalogs) {
        console.warn(
            `[@sigx/i18n] layerCatalogs["${layerOrder[0]}"] is ignored — that layer is filled by ` +
                `\`catalogs\`. Put overrides in a higher layer, or reorder \`layers\`.`
        );
    }
    rootLayers[layerOrder[0]] = catalogs;

    /**
     * Flatten a layer stack into one effective tree. Every `(locale, ns)` goes
     * through `composeAt`, whose global identity cache means a layer stack seen
     * before is not re-merged — a repeat tenant costs this walk, not the merge.
     *
     * When only one layer contributes, the tree is returned BY IDENTITY, so the
     * no-layers path allocates nothing and `messages` stays the very object the
     * caller passed in.
     */
    const effectiveOf = (layered: LayeredMessages): MessageTree => {
        const contributing = layerOrder.filter(layer => layered[layer]);
        if (contributing.length <= 1) return layered[contributing[0]] ?? {};
        const out: MessageTree = {};
        for (const layer of contributing) {
            const tree = layered[layer];
            for (const locale of Object.keys(tree)) {
                const bucket = (out[locale] ??= {});
                for (const ns of Object.keys(tree[locale])) {
                    if (!bucket[ns]) bucket[ns] = composeAt(layered, layerOrder, locale, ns) as Catalog;
                }
            }
        }
        return out;
    };

    // The seam: a locale-bound `TranslationSource` is all the shared translator
    // factories need, so the client's proxy works verbatim over a catalog tree.
    const sourceFor = (tree: MessageTree, locale: string): TranslationSource => ({
        translateKey: (namespace, key, params, opts) =>
            translateWith(tree, key, params, { locale, namespace }, tconfig, opts),
        hasKey: (namespace, key) => lookup(tree, key, { locale, namespace }, tconfig) !== undefined
    });

    const bind = (layered: LayeredMessages, tree: MessageTree, locale: string): LocaleTranslator => {
        const source = sourceFor(tree, locale);
        return {
            locale,
            t: (key, params, opts) =>
                source.translateKey(opts?.namespace ?? defaultNamespace, key, params, opts),
            exists: (key, opts) => source.hasKey(opts?.namespace ?? defaultNamespace, key),
            forNamespace: <NS extends KnownNamespace = KnownNamespace>(namespace?: NS) =>
                createTranslator(source, namespace ?? defaultNamespace) as unknown as TypedTranslator<NS>,
            dynamic: (namespace?: string) => createDynamicTranslator(source, namespace ?? defaultNamespace),
            withLayers: extra => {
                // A fresh stack; the receiver keeps its own, so one translator
                // serves many tenants without them leaking into each other.
                const merged: LayeredMessages = { ...layered, ...extra };
                return bind(merged, effectiveOf(merged), locale);
            }
        };
    };

    const rootTree = effectiveOf(rootLayers);
    const forLocale = (locale: string): LocaleTranslator => bind(rootLayers, rootTree, locale);

    return {
        messages: rootTree,
        t: (key, params, opts) => forLocale(opts?.locale ?? fallbackLocale).t(key, params, opts),
        exists: (key, opts) => forLocale(opts?.locale ?? fallbackLocale).exists(key, opts),
        forLocale
    };
}

export interface RequestTOptions extends ServerI18nOptions {
    /** Negotiation target set; empty/undefined accepts any locale. */
    supported?: readonly string[];
    /** Detection chain options (order, cookie/url names, extra detectors). */
    detection?: DetectionOptions;
}

/**
 * Build once, bind per request — the shape a server function wants:
 *
 * ```ts
 * const requestT = createRequestT({ catalogs, fallbackLocale: 'en', supported: ['en', 'sv'] });
 *
 * export const greet = serverFn(async (rq) =>
 *     requestT(rq.request).forNamespace('mail').greeting({ name: 'Ada' })
 * );
 * ```
 *
 * The result is the same {@link LocaleTranslator} `forLocale()` returns — the
 * request only decides *which* locale, so there is nothing else to model.
 *
 * `@sigx/server` is deliberately NOT imported: the caller passes `rq.request`,
 * so this stays usable from any handler (and from a plain fetch handler in a
 * platform entry) with no dependency in either direction.
 */
export function createRequestT(options: RequestTOptions): (request: RequestLike) => LocaleTranslator {
    const { supported, detection, ...serverOptions } = options;
    const translator = createServerT(serverOptions);

    return request =>
        translator.forLocale(
            resolveRequestLocale(request, {
                ...detection,
                supported,
                fallbackLocale: serverOptions.fallbackLocale
            })
        );
}
