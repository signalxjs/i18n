/**
 * Tests for the server translator — the universal entry (`@sigx/i18n/server`,
 * catalogs as data) and the Node fs loader (`@sigx/i18n/server/node`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServerT, createRequestT } from '../src/server.js';
import { loadCatalogs } from '../src/server-node.js';
import type { MessageTree } from '../src/types.js';

let root2: string; // locale/ns.json (+ nested ns)

function write(dir: string, rel: string, json: unknown): void {
    const parts = rel.split('/');
    const file = parts.pop() as string;
    const target = join(dir, ...parts);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, file), JSON.stringify(json), 'utf-8');
}

beforeAll(() => {
    root2 = mkdtempSync(join(tmpdir(), 'sigx-i18n-srv2-'));
    write(root2, 'en/mail.json', { welcome: 'Welcome {name}', items: { one: '# item', other: '# items' } });
    write(root2, 'sv/mail.json', { welcome: 'Välkommen {name}' }); // no `items` → fallback
    write(root2, 'en/admin/users.json', { title: 'Users' }); // nested namespace
});

afterAll(() => {
    rmSync(root2, { recursive: true, force: true });
});

describe('loadCatalogs — 2-level layout', () => {
    it('reads locale/namespace.json into a MessageTree, nested namespaces included', async () => {
        const catalogs = await loadCatalogs(root2);
        expect(Object.keys(catalogs).sort()).toEqual(['en', 'sv']);
        expect(catalogs.en.mail.welcome).toBe('Welcome {name}');
        expect(catalogs.en['admin/users'].title).toBe('Users');
        expect(catalogs.sv.mail).toBeDefined();
    });

    it('handles a missing locales directory gracefully', async () => {
        const catalogs = await loadCatalogs(join(tmpdir(), 'sigx-i18n-does-not-exist-xyz'));
        expect(catalogs).toEqual({});
        const i18n = createServerT({ catalogs, fallbackLocale: 'en' });
        expect(i18n.t('anything', {}, { locale: 'en', namespace: 'x' })).toBe('anything');
    });
});

describe('createServerT', () => {
    it('translates, interpolates, and falls back to the master locale', async () => {
        const i18n = createServerT({
            catalogs: await loadCatalogs(root2),
            fallbackLocale: 'en',
            defaultNamespace: 'mail'
        });

        expect(i18n.t('welcome', { name: 'Sam' }, { locale: 'sv' })).toBe('Välkommen Sam');
        expect(i18n.t('welcome', { name: 'Sam' })).toBe('Welcome Sam'); // default locale = master
        expect(i18n.t('items', { count: 2 }, { locale: 'sv' })).toBe('2 items'); // via en fallback
        expect(i18n.t('missing', {}, { locale: 'sv' })).toBe('missing');
    });

    it('forLocale binds a locale into a plain (key, params) function', async () => {
        const i18n = createServerT({ catalogs: await loadCatalogs(root2), fallbackLocale: 'en' });
        const t = i18n.forLocale('sv', { namespace: 'mail' });
        expect(t('welcome', { name: 'Åsa' })).toBe('Välkommen Åsa');
    });

    it('resolves a key under a nested namespace path', async () => {
        const i18n = createServerT({ catalogs: await loadCatalogs(root2), fallbackLocale: 'en' });
        expect(i18n.t('title', {}, { locale: 'en', namespace: 'admin/users' })).toBe('Users');
    });

    it('takes an inline tree with no filesystem involved (the edge path)', () => {
        const catalogs: MessageTree = { en: { mail: { hi: 'Hi' } }, sv: { mail: { hi: 'Hej' } } };
        const i18n = createServerT({ catalogs, fallbackLocale: 'en', defaultNamespace: 'mail' });
        expect(i18n.t('hi', {}, { locale: 'sv' })).toBe('Hej');
        expect(i18n.messages).toBe(catalogs);
    });
});

describe('createRequestT', () => {
    const catalogs: MessageTree = {
        en: { mail: { welcome: 'Welcome {name}' } },
        sv: { mail: { welcome: 'Välkommen {name}' } }
    };
    const requestT = createRequestT({
        catalogs,
        fallbackLocale: 'en',
        defaultNamespace: 'mail',
        supported: ['en', 'sv']
    });

    it('negotiates the locale from a WinterCG Request (Accept-Language)', () => {
        const request = new Request('https://example.test/api', {
            headers: { 'accept-language': 'sv-SE,sv;q=0.9,en;q=0.5' }
        });
        const m = requestT(request);
        expect(m.locale).toBe('sv');
        expect(m.t('welcome', { name: 'Ada' })).toBe('Välkommen Ada');
    });

    // `Cookie` is a forbidden header name for a browser-constructed `Request`,
    // and the happy-dom test environment enforces that — so the cookie cases
    // build the incoming request the way a server runtime hands it over:
    // a real `Headers` bag (workerd/Deno/Bun) or a header record (Node).
    const incoming = (url: string, headers: Record<string, string>) => ({ url, headers: new Headers(headers) });

    it('prefers the cookie over Accept-Language, and the query param over both', () => {
        expect(requestT(incoming('https://example.test/', { 'accept-language': 'en', cookie: 'locale=sv' })).locale)
            .toBe('sv');

        expect(
            requestT(incoming('https://example.test/?lang=en', { 'accept-language': 'sv', cookie: 'locale=sv' }))
                .locale
        ).toBe('en');
    });

    it('accepts a Node-style { url, headers } request', () => {
        const m = requestT({ url: '/page?lang=sv', headers: { 'Accept-Language': 'en' } });
        expect(m.locale).toBe('sv');
        expect(m.forNamespace('mail')('welcome', { name: 'Åsa' })).toBe('Välkommen Åsa');
    });

    it('falls back to the master locale when nothing matches', () => {
        expect(requestT(new Request('https://example.test/', { headers: { 'accept-language': 'de' } })).locale).toBe(
            'en'
        );
    });
});
