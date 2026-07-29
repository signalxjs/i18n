import { defineApp } from 'sigx';
import { resumePlugin } from '@sigx/resume';
import { resumeManifest } from 'virtual:sigx-manifests';
import { resolveRequestLocale } from '@sigx/i18n';
import type { IncomingMessage } from 'node:http';
import { App } from './App';
import { FALLBACK_LOCALE, SUPPORTED, i18nPlugin, preloadCatalogs } from './i18n';

/**
 * The per-request app factory. The locale is decided HERE, from the request —
 * `?lang=`, then the cookie, then `Accept-Language` — and the whole document is
 * rendered in it. That is the entire locale story for a resumable page: there is
 * no client-side switch to reconcile with.
 *
 * Catalogs are preloaded and passed as `initialMessages` so the render stays
 * synchronous (no async boundaries), which resumability requires. Only the
 * request's locale plus the master are loaded — the other language is one server
 * round trip away, not a payload.
 *
 * The resume pack installs HERE too: `app.use(...)` is the one install shape,
 * and its manifest comes from `virtual:sigx-manifests` (inlined by the SSR
 * build; `undefined` under dev, where resume runs manifest-less).
 */
export async function createApp(url: string, req?: IncomingMessage | Request) {
    const locale = req
        ? resolveRequestLocale(req as { url?: string; headers: Headers }, {
              supported: [...SUPPORTED],
              fallbackLocale: FALLBACK_LOCALE,
              order: ['url', 'cookie', 'browser'],
              urlParam: 'lang',
              // The dev handler passes no request in some setups; the URL is
              // always available, so `?lang=` works either way.
              context: { url }
          })
        : FALLBACK_LOCALE;

    return defineApp(<App url={url} />)
        .use(i18nPlugin({ locale, initialMessages: await preloadCatalogs(locale) }))
        .use(resumePlugin({ manifest: resumeManifest }));
}
