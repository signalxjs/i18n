/**
 * @sigx/i18n/server — a non-reactive, DI-free translator for server-only
 * localization: mail templates, queue jobs, API responses, PDFs.
 *
 * It reuses the exact same pure `translate` core (master fallback, locale chain)
 * and formatter as the client, but has zero dependency on sigx — no store, no
 * signals, no app — so it runs in a mailer worker with nothing else wired up.
 *
 * **This entry is universal**: no `node:` imports, so it runs unchanged on
 * workerd, Deno, Bun and inside a bundled edge build (the deploy adapters'
 * server builds forbid `node:` specifiers). Catalogs arrive as data — from
 * `virtual:sigx-i18n/server-catalogs` (emitted by `@sigx/i18n/vite`, the edge
 * path) or from `loadCatalogs()` in `@sigx/i18n/server/node` (the fs path).
 *
 * Server-only namespaces are simply files the client loader's glob never sees;
 * declare them as `serverOnly` on the Vite plugin to keep them out of the
 * client catalog tree entirely.
 */

import { translate } from './translate.js';
import { lightweightFormatter } from './formatter.js';
import { resolveRequestLocale, type DetectionOptions, type RequestLike } from './detect.js';
import type { Formatter, MessageTree, MissingInfo, Params } from './types.js';

export interface ServerI18nOptions {
    /** The catalog tree: `catalogs[locale][namespace]`. */
    catalogs: MessageTree;
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

/** Per-call scope override. */
export interface ServerScope {
    locale?: string;
    namespace?: string;
}

export interface ServerTranslator {
    /** Translate a key. `scope.locale` defaults to the master locale. */
    t(key: string, params?: Params, scope?: ServerScope): string;
    /** Bind a locale (and optional namespace) into a simple `(key, params) => string`. */
    forLocale(locale: string, scope?: Omit<ServerScope, 'locale'>): (key: string, params?: Params) => string;
    /** The message tree (locale → namespace → catalog), for inspection. */
    readonly messages: MessageTree;
}

/**
 * Create a server translator over an in-memory catalog tree.
 *
 * ```ts
 * import catalogs from 'virtual:sigx-i18n/server-catalogs';
 * const t = createServerT({ catalogs, fallbackLocale: 'en', defaultNamespace: 'mail' });
 * const m = t.forLocale('sv', { namespace: 'mail' });
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

    const tconfig = { fallbackLocale, localeFallbacks, formatter, onMissing };

    const t: ServerTranslator['t'] = (key, params, scope) =>
        translate(
            catalogs,
            key,
            params,
            { locale: scope?.locale ?? fallbackLocale, namespace: scope?.namespace ?? defaultNamespace },
            tconfig
        );

    const forLocale: ServerTranslator['forLocale'] = (locale, scope) => (key, params) =>
        t(key, params, { locale, namespace: scope?.namespace });

    return { t, forLocale, messages: catalogs };
}

/** A translator already bound to one request's negotiated locale. */
export interface RequestTranslator {
    /** The locale detection resolved for this request. */
    readonly locale: string;
    /** Translate a key in this request's locale. */
    t(key: string, params?: Params, scope?: Omit<ServerScope, 'locale'>): string;
    /** Bind a namespace into a simple `(key, params) => string`. */
    forNamespace(namespace: string): (key: string, params?: Params) => string;
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
 * export const greet = serverFn(async (rq) => requestT(rq.request).t('hello', { name: 'Ada' }));
 * ```
 *
 * `@sigx/server` is deliberately NOT imported: the caller passes `rq.request`,
 * so this stays usable from any handler (and from a plain fetch handler in a
 * platform entry) with no dependency in either direction.
 */
export function createRequestT(options: RequestTOptions): (request: RequestLike) => RequestTranslator {
    const { supported, detection, ...serverOptions } = options;
    const translator = createServerT(serverOptions);

    return request => {
        const locale = resolveRequestLocale(request, {
            ...detection,
            supported,
            fallbackLocale: serverOptions.fallbackLocale
        });
        return {
            locale,
            t: (key, params, scope) => translator.t(key, params, { ...scope, locale }),
            forNamespace: namespace => translator.forLocale(locale, { namespace })
        };
    };
}
