/** Tests for @sigx/i18n/server — DI-free filesystem translator. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServerT } from '../src/server.js';

let root2: string; // 2-level: locale/ns.json
let root3: string; // 3-level: target/locale/ns.json

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

    root3 = mkdtempSync(join(tmpdir(), 'sigx-i18n-srv3-'));
    write(root3, 'common/en/nav.json', { home: 'Home' });
    write(root3, 'admin/en/nav.json', { dash: 'Dashboard' });
});

afterAll(() => {
    rmSync(root2, { recursive: true, force: true });
    rmSync(root3, { recursive: true, force: true });
});

describe('createServerT — 2-level layout', () => {
    it('translates, interpolates, and falls back to the master locale', async () => {
        const i18n = await createServerT({ localesDir: root2, fallbackLocale: 'en', defaultNamespace: 'mail' });

        expect(i18n.t('welcome', { name: 'Sam' }, { locale: 'sv' })).toBe('Välkommen Sam');
        expect(i18n.t('welcome', { name: 'Sam' })).toBe('Welcome Sam'); // default locale = master
        expect(i18n.t('items', { count: 2 }, { locale: 'sv' })).toBe('2 items'); // via en fallback
        expect(i18n.t('missing', {}, { locale: 'sv' })).toBe('missing');
    });

    it('forLocale binds a locale into a plain (key, params) function', async () => {
        const i18n = await createServerT({ localesDir: root2, fallbackLocale: 'en' });
        const t = i18n.forLocale('sv', { namespace: 'mail' });
        expect(t('welcome', { name: 'Åsa' })).toBe('Välkommen Åsa');
    });
});

describe('createServerT — 3-level layout with targets', () => {
    it('resolves through the extends base and prefers the active target', async () => {
        const i18n = await createServerT({
            localesDir: root3,
            fallbackLocale: 'en',
            defaultNamespace: 'nav',
            targets: { admin: { extends: 'common' }, common: {} }
        });

        expect(i18n.t('home', {}, { locale: 'en', target: 'admin' })).toBe('Home'); // via extends
        expect(i18n.t('dash', {}, { locale: 'en', target: 'admin' })).toBe('Dashboard');
        expect(i18n.t('dash', {}, { locale: 'en', target: 'common' })).toBe('dash'); // base can't see admin
    });
});

describe('createServerT — robustness', () => {
    it('handles a missing locales directory gracefully', async () => {
        const i18n = await createServerT({ localesDir: join(tmpdir(), 'sigx-i18n-does-not-exist-xyz'), fallbackLocale: 'en' });
        expect(i18n.t('anything', {}, { locale: 'en', namespace: 'x' })).toBe('anything');
    });
});
