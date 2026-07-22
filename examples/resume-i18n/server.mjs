// The localized resumability server — the two-mode shape from core's
// examples/resume, with one i18n-specific middleware: persisting an explicit
// `?lang=` choice as a cookie, so the server-round-trip locale switch sticks.
//
// Run production with `--conditions production` for the NODE_ENV-stripped
// dist builds (works without it too).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createSSR } from '@sigx/server-renderer';
import { resumePlugin } from '@sigx/resume';
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
        // Dev: Vite middleware + ONE handler. The @sigx family is externalized
        // from the runner (vite.config.ts), so this module's resumePlugin() and
        // the handler's renderer are the same instances. No manifest in dev:
        // QRLs and upgrade chunks resolve through the virtual registry.
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
                isBot,
                ssr: createSSR().use(resumePlugin())
            })
        );
    } else {
        // Prod: static assets + the server-function endpoint + ONE document
        // handler, over the built artifacts. (On @sigx/vite 0.13+ the four reads
        // below collapse into one `import('./dist/server/sigx-app.js')` — the
        // build materializes template/assets/manifests as a module. This example
        // targets the published 0.12 line.)
        const { readFile } = await import('node:fs/promises');
        const { createRequestHandler } = await import('@sigx/server-renderer/node');
        const { collectAssets } = await import('@sigx/vite/ssr');
        const { createServerFnHandler } = await import('@sigx/server/node');

        const clientDir = resolve(__dirname, 'dist/client');
        const readJson = async (rel) => JSON.parse(await readFile(resolve(clientDir, rel), 'utf-8'));

        const template = await readFile(resolve(clientDir, 'index.html'), 'utf-8');
        const assets = collectAssets(await readJson('.vite/manifest.json'), ['src/entry-client.ts']);
        // The resume manifest maps boundaries to their QRL/upgrade chunks. In dev
        // there is none — the virtual registry resolves them.
        const resumeManifest = await readJson('.vite/sigx-resume-manifest.json');

        const { createApp } = await import(new URL('./dist/server/entry-server.js', import.meta.url).href);
        const { serverFns } = await import(new URL('./dist/server/sigx-server-fns.js', import.meta.url).href);

        const ssr = createSSR().use(resumePlugin({ manifest: resumeManifest }));

        app.use(express.static(clientDir, { index: false }));
        app.use(createServerFnHandler({ functions: serverFns }));
        app.use(
            createRequestHandler({
                template,
                // `req` carries Cookie + Accept-Language → server-side negotiation.
                app: (url, req) => createApp(url, req),
                isBot,
                ssr,
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
