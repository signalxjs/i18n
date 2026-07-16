// Server-side localization with @sigx/i18n/server — no client JavaScript.
// Renders localized HTML pages and an email preview, choosing the locale from
// ?lang, a `locale` cookie, or the Accept-Language header (server has them all).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServerT } from '@sigx/i18n/server';
import { parseAcceptLanguage, findSupported } from '@sigx/i18n';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const supported = ['en', 'sv'];

// One translator, catalogs read from disk once (mail namespace is server-only).
const t = await createServerT({
    localesDir: resolve(__dirname, 'src/locales'),
    fallbackLocale: 'en'
});

/** url ?lang → cookie → Accept-Language → master. */
function pickLocale(req) {
    const q = req.query.lang;
    if (typeof q === 'string') {
        const m = findSupported(q, supported);
        if (m) return m;
    }
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)locale=([^;]+)/)?.[1];
    if (cookie) {
        const m = findSupported(decodeURIComponent(cookie), supported);
        if (m) return m;
    }
    for (const cand of parseAcceptLanguage(req.headers['accept-language'] ?? '')) {
        const m = findSupported(cand, supported);
        if (m) return m;
    }
    return 'en';
}

const layout = (locale, inner) =>
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>@sigx/i18n · server</title>` +
    `<style>body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem}` +
    `nav a{margin-right:.75rem}code{background:#8881;padding:.1rem .3rem;border-radius:4px}` +
    `.card{border:1px solid #8883;border-radius:12px;padding:1.25rem 1.5rem;margin-top:1rem}</style>` +
    `</head><body>${inner}</body></html>`;

const app = express();

app.get('/', (req, res) => {
    const locale = pickLocale(req);
    const w = t.forLocale(locale, { namespace: 'web' });
    res.type('html').send(
        layout(
            locale,
            `<nav>lang: <a href="/?lang=en">EN</a><a href="/?lang=sv">SV</a></nav>` +
                `<h1>${w('title')}</h1>` +
                `<p>${w('intro', { locale })}</p>` +
                `<p><strong>${w('users', { count: 1337 })}</strong></p>` +
                `<p><a href="/mail?lang=${locale}">${w('cta')} → view a localized email</a></p>`
        )
    );
});

// A SERVER-ONLY namespace (mail) — never shipped to a client bundle.
app.get('/mail', (req, res) => {
    const locale = pickLocale(req);
    const name = typeof req.query.to === 'string' ? req.query.to : 'Andreas';
    const m = t.forLocale(locale, { namespace: 'mail' });
    res.type('html').send(
        layout(
            locale,
            `<nav>lang: <a href="/mail?lang=en">EN</a><a href="/mail?lang=sv">SV</a> · <a href="/?lang=${locale}">home</a></nav>` +
                `<div class="card">` +
                `<p style="opacity:.6">Subject: ${m('subject')}</p>` +
                `<h2>${m('welcome', { name })}</h2>` +
                `<p>${m('body', { credits: 4200 })}</p>` +
                // `ps` exists only in en/mail.json → falls back to the master locale in sv
                `<p style="opacity:.75">${m('ps')}</p>` +
                `<p>${m('signoff')}</p>` +
                `</div>`
        )
    );
});

app.listen(port, () => {
    console.log(`[i18n-ssr] http://localhost:${port}  (try /?lang=sv and /mail?lang=sv)`);
});
