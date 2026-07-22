import { serverFn } from '@sigx/server';
import { createRequestT } from '@sigx/i18n/server';
import catalogs from 'virtual:sigx-i18n/server-catalogs';
import { FALLBACK_LOCALE, SUPPORTED } from './i18n';

/**
 * A server module (rfc-server §1.1) — this file only ever runs on the server;
 * the client build swaps it for typed fetch stubs.
 *
 * The catalogs come from `virtual:sigx-i18n/server-catalogs`, the module
 * `@sigx/i18n/vite` emits for the namespaces declared `serverOnly` (here:
 * `mail`). Two things follow: those strings are never in the client graph, and
 * there is no `node:fs` anywhere in this path — the tree is inlined as code, so
 * this same file works in the bundled Cloudflare build.
 */
const requestT = createRequestT({
    catalogs,
    fallbackLocale: FALLBACK_LOCALE,
    supported: [...SUPPORTED],
    defaultNamespace: 'mail',
    detection: { order: ['url', 'cookie', 'browser'], urlParam: 'lang' }
});

/**
 * Answers in the caller's language. `rq.request` is passed explicitly — i18n
 * never imports `@sigx/server`, and `@sigx/server` never imports i18n.
 */
export const greet = serverFn(async (rq, name: string) => {
    const m = requestT(rq.request);
    return `${m.t('greeting', { name })} ${m.t('signoff')} [${m.locale}]`;
});
