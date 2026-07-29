// The localized resumability server — the two-mode shape from core's
// examples/resume, with one i18n-specific middleware: persisting an explicit
// `?lang=` choice as a cookie, so the server-round-trip locale switch sticks.
//
// Run production with `--conditions production` for the NODE_ENV-stripped
// dist builds (works without it too).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { localeCookie } from '@sigx/i18n';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;
const SUPPORTED = ['en', 'sv'];

// Crawlers get the blocking document: complete content, nothing to execute.
// (Which, on this page, is what every visitor gets until they interact.)
const isBot = (ua) => /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|headless/i.test(ua ?? '');

/**
 * The other half of the zero-JS locale switch: the link carries `?lang=`, and
 * this makes the choice stick for every later request. Not httpOnly — the client
 * cookie detector reads it too, so both sides agree.
 */
function persistLocale(req, res, next) {
    const requested = typeof req.query.lang === 'string' ? req.query.lang : null;
    if (requested && SUPPORTED.includes(requested)) {
        res.append('Set-Cookie', localeCookie(requested));
    }
    next();
}

async function createServer() {
    const app = express();
    app.use(persistLocale);

    if (!isProd) {
        // Dev: Vite middleware + ONE handler. The app factory carries both packs
        // (src/entry-server.tsx — `app.use(...)` is the one install shape); no
        // manifest in dev, where QRLs and upgrade chunks resolve through the
        // virtual registry. The @sigx family is externalized from the runner
        // (vite.config.ts) so the handler and the app share module instances.
        const { createServer: createViteServer } = await import('vite');
        const { createDevRequestHandler } = await import('@sigx/vite/ssr');

        const vite = await createViteServer({
            root: __dirname,
            server: { middlewareMode: true },
            appType: 'custom'
        });
        app.use(vite.middlewares);
        app.use(
            await createDevRequestHandler(vite, {
                entry: '/src/entry-server.tsx',
                isBot
            })
        );
    } else {
        // Prod: static assets + the server-function endpoint + ONE document
        // handler. ONE import replaces four readFiles + inline collectAssets
        // (rfc-deploy §3.2): the build materializes template/assets/manifests as
        // dist/server/sigx-app.js. The resume manifest is NOT read here — the app
        // factory pulls it from `virtual:sigx-manifests` and installs the pack
        // itself. The fn registry stays its own import: explicit, never ambient.
        const { createRequestHandler } = await import('@sigx/server-renderer/node');
        const { createServerFnHandler } = await import('@sigx/server/node');

        const { template, assets } = await import(new URL('./dist/server/sigx-app.js', import.meta.url).href);
        const { createApp } = await import(new URL('./dist/server/entry-server.js', import.meta.url).href);
        const { serverFns } = await import(new URL('./dist/server/sigx-server-fns.js', import.meta.url).href);

        app.use(express.static(resolve(__dirname, 'dist/client'), { index: false }));
        app.use(createServerFnHandler({ functions: serverFns }));
        app.use(
            createRequestHandler({
                template,
                // `req` carries Cookie + Accept-Language → server-side negotiation.
                app: (url, req) => createApp(url, req),
                isBot,
                document: { assets }
            })
        );
    }

    app.listen(port, () => {
        console.log(
            `[i18n-resume] ${isProd ? 'production' : 'dev'} server on http://localhost:${port}` +
                `  (try /?lang=sv)`
        );
    });
}

createServer();
