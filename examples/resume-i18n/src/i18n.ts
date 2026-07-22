import {
    createI18n,
    provideI18nConfig,
    type I18nOptions,
    type LocaleLoader,
    type MessageTree
} from '@sigx/i18n';
import type { Plugin } from '@sigx/runtime-core';

/**
 * The app's i18n configuration, in ONE module — imported by the server entry
 * (which installs it as a plugin) and by resumable components (which need it
 * available with no app at all; see the `provideI18nConfig` call at the bottom).
 *
 * `mail` is deliberately absent from the glob: it is a server-only namespace,
 * declared as `serverOnly` on the Vite plugin, so it lives in
 * `virtual:sigx-i18n/server-catalogs` and never enters the client graph.
 */
const catalogs = import.meta.glob('./locales/*/{page,counter}.json');

const loadCatalog: LocaleLoader = (locale, ns) => {
    const loader = catalogs[`./locales/${locale}/${ns}.json`];
    return (loader ? loader() : Promise.resolve({})) as ReturnType<LocaleLoader>;
};

export const SUPPORTED = ['en', 'sv'] as const;
export const NAMESPACES = ['page', 'counter'] as const;
export const FALLBACK_LOCALE = 'en';

/** Load `messages[locale][namespace]` for one locale plus the master. */
export async function preloadCatalogs(locale: string): Promise<MessageTree> {
    const locales = locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE];
    const tree: MessageTree = {};
    await Promise.all(
        locales.flatMap(loc =>
            NAMESPACES.map(async ns => {
                const mod = (await loadCatalog(loc, ns)) as Record<string, unknown> & { default?: unknown };
                (tree[loc] ??= {})[ns] = (mod.default ?? mod) as MessageTree[string][string];
            })
        )
    );
    return tree;
}

/** The options both entry points share, so server and client cannot drift. */
export function i18nOptions(over: { locale?: string; initialMessages?: MessageTree } = {}): I18nOptions {
    return {
        fallbackLocale: FALLBACK_LOCALE,
        supported: [...SUPPORTED],
        defaultNamespace: 'page',
        // No eager `namespaces`: the server hands the render everything it needs
        // through `initialMessages`, and on the client each namespace loads only
        // when a component that uses it actually renders. That is what keeps an
        // upgrade cheap — clicking the counter fetches `counter`, not `page`.
        // ONE decision point: the server negotiated the locale from the request
        // (entry-server.tsx) and hands it in here. The store's own detection
        // chain is off, so there is exactly one answer per request and no way
        // for the store to reach a different one than the preload did.
        initialLocale: over.locale,
        detect: false,
        // The locale is decided by the SERVER, every time — the switch is a real
        // round trip (see LocaleSwitch.tsx), so there is no device-local choice
        // to restore and nothing for `persist` to fight the server about.
        //
        // `transferMessages: false` is the resumability part: this page ships no
        // component JS on load, so catalogs in the transfer blob would be bytes
        // nothing reads — every string is already in the HTML. The LOCALE still
        // transfers, so a boundary that upgrades knows its language and fetches
        // only the namespace it needs.
        persistence: { persist: false, transferMessages: false },
        initialMessages: over.initialMessages,
        load: loadCatalog
    };
}

/** The app-level install — used by the server entry. */
export function i18nPlugin(over: Parameters<typeof i18nOptions>[0] = {}): Plugin {
    return createI18n(i18nOptions(over));
}

/**
 * The app-less install — the resumability half.
 *
 * A resumable page has no client app: `@sigx/resume` hydrates an upgraded
 * boundary by calling `hydrateComponent` directly, so nothing ever installed the
 * plugin in the browser. A component that translates against state which changes
 * client-side (`resume/Counter.tsx` — a plural that depends on a live count)
 * would find no config and throw.
 *
 * This side effect is how the config gets there. It costs nothing on load: this
 * module is only in the client graph via those components' chunks, which load on
 * first upgrade and never before. On the server it is a documented no-op — the
 * plugin install above is the per-request-correct path.
 */
provideI18nConfig(i18nOptions());
