import { createI18n, type LocaleLoader, type DetectionContext, type MessageTree } from '@sigx/i18n';
import type { Plugin } from '@sigx/runtime-core';

// Vite maps each client-facing catalog to a lazy import. `mail` is deliberately
// excluded — it's a server-only namespace (rendered by @sigx/i18n/server in the
// /mail route), so it never ships to the browser.
const catalogs = import.meta.glob('./locales/*/{home,app}.json');
const loadCatalog: LocaleLoader = (locale, ns) => {
    const loader = catalogs[`./locales/${locale}/${ns}.json`];
    return (loader ? loader() : Promise.resolve({})) as ReturnType<LocaleLoader>;
};

export const SUPPORTED = ['en', 'sv'] as const;
export const NAMESPACES = ['home', 'app'] as const;

/**
 * Load catalogs into a `messages[locale][namespace]` tree. The server calls this
 * before rendering and passes the result as `initialMessages`, so the render is
 * synchronous — no async boundaries, so the server/client VNode trees match and
 * hydration wires up cleanly. `ssrState` then transfers the tree to the client.
 */
export async function preloadCatalogs(
    locales: readonly string[] = SUPPORTED,
    namespaces: readonly string[] = NAMESPACES
): Promise<MessageTree> {
    const tree: MessageTree = {};
    await Promise.all(
        locales.flatMap(locale =>
            namespaces.map(async ns => {
                const mod = (await loadCatalog(locale, ns)) as Record<string, unknown> & { default?: unknown };
                (tree[locale] ??= {})[ns] = (mod.default ?? mod) as MessageTree[string][string];
            })
        )
    );
    return tree;
}

/**
 * The i18n plugin, shared by both entries so server and client agree on the
 * loader, supported set, and detection chain. The server passes request data
 * (`headers`/`url`) as the detection `context` plus preloaded `initialMessages`;
 * the client omits both (it seeds locale + messages from `ssrState`). The
 * server's locale wins regardless, because the seed overrides client detection.
 */
export function i18nPlugin(opts: { context?: DetectionContext; initialMessages?: MessageTree } = {}): Plugin {
    return createI18n({
        fallbackLocale: 'en',
        supported: [...SUPPORTED],
        defaultNamespace: 'home',
        namespaces: ['home'],
        detection: { order: ['url', 'cookie', 'browser'], urlParam: 'lang', context: opts.context },
        // URL/header-driven locale is authoritative for SSR; skip localStorage so
        // the server-chosen locale isn't overridden on the client after hydration.
        persistence: { persist: false },
        initialMessages: opts.initialMessages,
        load: loadCatalog
    });
}

// Deterministic demo data — identical on server and client so the hydrated
// markup matches byte-for-byte (no `new Date()`/random at render time).
export const DEMO = {
    users: 3,
    revenue: 128400,
    updatedAt: new Date('2026-07-01T00:00:00Z')
};
