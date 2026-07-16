/** Tests for many concurrent targets (Phase 7). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { createI18n, type I18nOptions } from '../src/plugin.js';
import { useI18n } from '../src/store.js';

// Loader that encodes (target, locale, ns) so we can assert what loaded where.
const makeLoad = () =>
    vi.fn(async (target: string, locale: string, ns: string) => ({ hi: `${target || 'base'}/${locale}/${ns}` }));

function scenario(load: I18nOptions['load'], over: Partial<I18nOptions> = {}) {
    const app = defineApp(jsx('div', {}));
    app.use(
        createI18n({
            fallbackLocale: 'en',
            supported: ['en', 'sv'],
            detect: false,
            persistence: false,
            targets: { marketing: {}, app: {}, common: {} },
            load,
            ...over
        })
    );
    return app.runWithContext(() => useI18n());
}

const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => localStorage.clear());

describe('many targets concurrently', () => {
    it('loads each (target, ns) scope independently', async () => {
        const load = makeLoad();
        const store = scenario(load);

        await store.ensureNamespace('nav', 'marketing');
        await store.ensureNamespace('nav', 'app');
        await flush();

        expect(store.translateKey('nav', 'hi', undefined, 'marketing')).toBe('marketing/en/nav');
        expect(store.translateKey('nav', 'hi', undefined, 'app')).toBe('app/en/nav');
    });

    it('setLocale reloads every active target scope, not just the default', async () => {
        const load = makeLoad();
        const store = scenario(load);
        await store.ensureNamespace('nav', 'marketing');
        await store.ensureNamespace('nav', 'app');

        await store.setLocale('sv');
        await flush();

        expect(store.translateKey('nav', 'hi', undefined, 'marketing')).toBe('marketing/sv/nav');
        expect(store.translateKey('nav', 'hi', undefined, 'app')).toBe('app/sv/nav');
        // both targets loaded for sv (en was loaded at init/ensure)
        const svCalls = load.mock.calls.filter(c => c[1] === 'sv').map(c => c[0]).sort();
        expect(svCalls).toEqual(['app', 'marketing']);
    });

    it('a target used only via override still loads its catalogs', async () => {
        const load = makeLoad();
        const store = scenario(load);
        // never setTarget('app') — only read it via override
        await store.ensureNamespace('nav', 'app');
        await flush();
        expect(store.translateKey('nav', 'hi', undefined, 'app')).toBe('app/en/nav');
    });

    it('keeps targets isolated (no cross-target bleed)', async () => {
        const store = scenario(undefined);
        store.addMessages('marketing', 'en', 'nav', { hi: 'Marketing' });
        store.addMessages('app', 'en', 'nav', { hi: 'App' });

        expect(store.translateKey('nav', 'hi', undefined, 'marketing')).toBe('Marketing');
        expect(store.translateKey('nav', 'hi', undefined, 'app')).toBe('App');
    });

    it('loadTarget preloads a target for all active namespaces without switching', async () => {
        const load = makeLoad();
        const store = scenario(load, { namespaces: ['nav'] });
        await store.whenReady; // seeds nav on the default target

        await store.loadTarget('marketing');
        await flush();
        expect(store.target).toBe(''); // default unchanged
        expect(store.translateKey('nav', 'hi', undefined, 'marketing')).toBe('marketing/en/nav');
    });
});
