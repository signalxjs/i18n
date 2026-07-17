/** Tests that namespaces load lazily on first use (per-surface payload split). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { createI18n, type I18nOptions } from '../src/plugin.js';
import { useI18n } from '../src/store.js';

const makeLoad = () => vi.fn(async (locale: string, ns: string) => ({ hi: `${locale}/${ns}` }));

function scenario(load: I18nOptions['load'], over: Partial<I18nOptions> = {}) {
    const app = defineApp(jsx('div', {}));
    app.use(createI18n({ fallbackLocale: 'en', supported: ['en', 'sv'], detect: false, persistence: false, load, ...over }));
    return app.runWithContext(() => useI18n());
}

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => localStorage.clear());

describe('lazy namespace loading', () => {
    it('loads a namespace only when first used, not before', async () => {
        const load = makeLoad();
        const store = scenario(load); // no config.namespaces → nothing eager
        await flush();
        expect(load).not.toHaveBeenCalled(); // nothing loaded until used

        await store.ensureNamespace('cart');
        expect(load).toHaveBeenCalledWith('en', 'cart');
        expect(store.translateKey('cart', 'hi')).toBe('en/cart');
    });

    it('never loads a namespace the app does not use (per-surface split)', async () => {
        const load = makeLoad();
        const store = scenario(load);
        await store.ensureNamespace('public/home');
        await flush();
        const loadedNs = load.mock.calls.map(c => c[1]);
        expect(loadedNs).toContain('public/home');
        expect(loadedNs).not.toContain('admin/dashboard'); // never requested → never loaded
    });

    it('loads hierarchical namespace paths', async () => {
        const load = makeLoad();
        const store = scenario(load);
        await store.ensureNamespace('admin/users');
        expect(load).toHaveBeenCalledWith('en', 'admin/users');
        expect(store.translateKey('admin/users', 'hi')).toBe('en/admin/users');
    });

    it('loads active + fallback locale, and reloads active namespaces on setLocale', async () => {
        const load = makeLoad();
        const store = scenario(load, { namespaces: ['nav'] });
        await store.whenReady; // nav loaded for en (== fallback)
        expect(load).toHaveBeenCalledWith('en', 'nav');

        await store.setLocale('sv');
        await flush();
        expect(load).toHaveBeenCalledWith('sv', 'nav');
        expect(store.translateKey('nav', 'hi')).toBe('sv/nav');
    });

    it('is idempotent — a namespace is fetched at most once per locale', async () => {
        const load = makeLoad();
        const store = scenario(load);
        await store.ensureNamespace('cart');
        await store.ensureNamespace('cart');
        expect(load.mock.calls.filter(c => c[1] === 'cart' && c[0] === 'en')).toHaveLength(1);
    });
});
