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
 *
 * `allowAnonymous: true` is a real declaration, not boilerplate: core 0.15's
 * fail-closed runtime denies any server function with no decided access policy
 * (rfc-server-v4 §1.2, §5), so that "deliberately public" and "forgot the
 * guard" cannot look alike. It waives only the identity gate — middleware and
 * authentication still run. A greeting that reads nothing and writes nothing
 * is genuinely open — and it stays greppable for a security review.
 */
export const greet = serverFn<string, string>({
    allowAnonymous: true,
    handler(rq, name) {
        const rt = requestT(rq.request);
        // `forNamespace` gives the same typed proxy the client gets from
        // `useTranslation` — `greeting`/`signoff` are checked against the
        // generated Schema, so renaming a key in mail.json fails the build
        // instead of the email.
        const m = rt.forNamespace('mail');
        return `${m.greeting({ name })} ${m.signoff()} [${rt.locale}]`;
    }
});
