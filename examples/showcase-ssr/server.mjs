// SSR server for the @sigx/i18n showcase — plain Node, no transpiler.
//   • dev  : Vite middleware + one SSR handler (real SignalX component render)
//   • prod : static assets + one SSR handler over the built entry
//   • /mail: a server-ONLY render via @sigx/i18n/server (no app, no DOM) —
//            catalogs that never ship to the browser (mail templates).
// Run production with `--conditions production` for the NODE_ENV-stripped dist.
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const localesDir = resolve(__dirname, 'src/locales');

// Bots get the blocking document (all content inline); browsers stream + hydrate.
// Either way the HTML is fully translated: the entry preloads this page's
// catalogs before rendering, so the render is synchronous — there are no async
// boundaries, and the streamed shell already carries every translation.
const isBot = (ua) => /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|headless/i.test(ua ?? '');

// A server-ONLY route: render a localized email with the DI-free translator.
// Its `mail` namespace is never in the client loader's glob — server-only.
async function mailRoute(req, res) {
    // The fs loader lives in `/server/node`; `createServerT` itself is universal
    // (no `node:` imports) so the same call runs in a bundled edge build over
    // `virtual:sigx-i18n/server-catalogs` instead.
    const { createServerT, loadCatalogs } = await import('@sigx/i18n/server/node');
    const t = createServerT({
        catalogs: await loadCatalogs(localesDir),
        fallbackLocale: 'en',
        defaultNamespace: 'mail'
    });
    const locale = typeof req.query.lang === 'string' ? req.query.lang : 'en';
    const m = t.forLocale(locale, { namespace: 'mail' });
    const name = 'Ada';
    res.type('html').send(
        `<!doctype html><meta charset="utf-8"><title>${m('subject')}</title>` +
            `<div style="font:15px/1.6 system-ui;max-width:520px;margin:3rem auto;padding:1.5rem;border:1px solid #8883;border-radius:12px">` +
            `<nav style="margin-bottom:1rem">lang: <a href="/mail?lang=en">EN</a> · <a href="/mail?lang=sv">SV</a> · <a href="/">← app</a></nav>` +
            `<p style="opacity:.6">Subject: ${m('subject')}</p>` +
            `<h2 style="margin-top:0">${m('welcome', { name })}</h2>` +
            `<p>${m('body', { credits: 250 })}</p>` +
            // `ps` exists only in en/mail.json → falls back to the master locale in sv
            `<p style="opacity:.75">${m('ps')}</p>` +
            `<p style="opacity:.6">${m('signoff')}</p>` +
            `<hr style="border:none;border-top:1px solid #8882;margin:1.5rem 0">` +
            `<p style="opacity:.5;font-size:.85em">Rendered on the server with <code>@sigx/i18n/server</code> — ` +
            `no app, no DOM, no client bundle.</p></div>`
    );
}

async function createServer() {
    const app = express();
    app.get('/mail', mailRoute);

    if (!isProd) {
        // Dev: Vite middleware + ONE handler. `createDevRequestHandler` loads the
        // renderer through the same SSR module runner as the app (one module
        // graph → one runtime-core → DI tokens line up), transforms the template,
        // and owns the bot/stream/status dispatch.
        const { createServer: createViteServer } = await import('vite');
        const { createDevRequestHandler } = await import('@sigx/vite/ssr');
        const vite = await createViteServer({
            root: __dirname,
            server: { middlewareMode: true },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        app.use(await createDevRequestHandler(vite, { entry: '/src/entry-server.tsx', isBot }));
    } else {
        // Prod: static assets + ONE handler over the built entry.
        const { createRequestHandler } = await import('@sigx/server-renderer/node');
        const clientDir = resolve(__dirname, 'dist/client');
        const template = await readFile(resolve(clientDir, 'index.html'), 'utf-8');
        const { createApp } = await import(
            pathToFileURL(resolve(__dirname, 'dist/server/entry-server.js')).href
        );
        app.use(express.static(clientDir, { index: false }));
        app.use(
            createRequestHandler({
                template,
                // Prod passes `req` too → header detection (Accept-Language/Cookie).
                app: (url, req) => createApp(url, req),
                isBot
            })
        );
    }

    app.listen(port, () => {
        console.log(
            `[i18n-ssr] ${isProd ? 'production' : 'dev'} server on http://localhost:${port}` +
                `  (try /?lang=sv and /mail?lang=sv)`
        );
    });
}

createServer();
