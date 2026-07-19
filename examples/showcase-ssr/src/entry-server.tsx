import { defineApp } from 'sigx';
import type { IncomingMessage } from 'node:http';
import { App } from './App';
import { i18nPlugin, preloadCatalogs } from './i18n';

/**
 * The per-request app factory (the SSR entry contract): a FRESH app + i18n store
 * scoped to this URL/request, so concurrent renders never share a locale.
 *
 * We PRELOAD the catalogs into a message tree and hand them to the store as
 * `initialMessages`. The store (created lazily during the render) seeds them
 * synchronously, so the render resolves every translation from memory — no async
 * boundaries, so the server VNode tree matches the client's (which seeds the same
 * catalogs from `ssrState`), and hydration wires up events. Because the store is
 * created *during* the render, its `ssrState` hook attaches to the render context
 * and serializes the tree + locale to `__SIGX_ASYNC__`.
 *
 * The prod handler (`@sigx/server-renderer/node`) passes `(url, req)`, so we get
 * `Accept-Language` + `Cookie` for header-based detection. The dev handler
 * (`@sigx/vite/ssr`) passes only `url`, so dev detects from `?lang=`.
 */
export async function createApp(url: string, req?: IncomingMessage) {
    const headers = req?.headers as Record<string, string | string[] | undefined> | undefined;
    // Preload all supported locales so a client-side locale switch is instant
    // (already seeded — no fetch). A larger app would preload only the active
    // locale and lazy-load the rest, as the SPA showcase does.
    const initialMessages = await preloadCatalogs();
    const app = defineApp(<App />);
    app.use(i18nPlugin({ context: { url, headers }, initialMessages }));
    return app;
}
