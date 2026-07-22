/** Tests for @sigx/i18n detection + persistence + SSR transfer through the store. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { useI18n, useI18nConfig, type I18nRuntimeConfig } from '../src/store.js';
import { resetDocumentSeed } from '../src/persist-ssr.js';

function setup(config: I18nRuntimeConfig) {
    const app = defineApp(jsx('div', {}));
    app.defineProvide(useI18nConfig, () => config);
    return app.runWithContext(() => useI18n());
}

const flush = () => new Promise(r => setTimeout(r, 0));

// A deterministic base config: detection reads a fixed Accept-Language header.
const base = (over: Partial<I18nRuntimeConfig> = {}): I18nRuntimeConfig => ({
    fallbackLocale: 'en',
    supported: ['en', 'sv', 'de'],
    detection: { order: ['browser'], context: { headers: { 'accept-language': 'en' } } },
    ...over
});

beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __SIGX_ASYNC__?: unknown }).__SIGX_ASYNC__;
    resetDocumentSeed(); // each test is its own "document"
});

describe('detection at init', () => {
    it('resolves the initial locale from the request context', async () => {
        const store = setup(base({ detection: { context: { headers: { 'accept-language': 'sv,en;q=0.9' } } } }));
        await store.whenReady;
        expect(store.locale).toBe('sv');
    });

    it('honours detect:false (stays on fallback)', async () => {
        const store = setup(base({ detect: false, detection: { context: { headers: { 'accept-language': 'sv' } } } }));
        await store.whenReady;
        expect(store.locale).toBe('en');
    });
});

describe('persistence round-trip', () => {
    it('persists the chosen locale and rehydrates it, overriding detection', async () => {
        const store = setup(base());
        await store.whenReady;
        expect(store.locale).toBe('en'); // detected

        await store.setLocale('sv');
        await flush(); // let the persist watcher write

        // Fresh instance, same storage key → device choice wins over detection.
        const store2 = setup(base());
        await store2.whenReady;
        expect(store2.locale).toBe('sv');
    });

    it('does not persist when persistence is disabled', async () => {
        const store = setup(base({ persistence: false }));
        await store.whenReady;
        await store.setLocale('sv');
        await flush();
        const store2 = setup(base({ persistence: false }));
        await store2.whenReady;
        expect(store2.locale).toBe('en'); // nothing persisted → detection again
    });
});

describe('SSR state transfer', () => {
    const seedBlob = () => {
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };
    };

    it('seeds locale + messages from the server blob and skips detection', async () => {
        seedBlob();
        const store = setup(base());
        await store.whenReady;

        expect(store.ssrHydrated).toBe(true);
        expect(store.locale).toBe('de'); // server seed overrides detection
        expect(store.translateKey('common', 'hi')).toBe('Hallo');
    });

    // `@sigx/store`'s ssrState is consume-once (it deletes its blob entry). With
    // islands, every island root is its own scope and so its own store — without
    // the remembered seed, island #2 would render in the wrong language.
    it('re-seeds a SECOND instance in the same document (islands, resumed boundaries)', async () => {
        seedBlob();
        const first = setup(base({ persistence: { persist: false } }));
        await first.whenReady;
        expect(first.locale).toBe('de');

        const second = setup(base({ persistence: { persist: false } }));
        await second.whenReady;

        expect(second.ssrHydrated).toBe(true);
        expect(second.locale).toBe('de');
        expect(second.translateKey('common', 'hi')).toBe('Hallo');
    });

    it('gives each instance its own catalog tree (no shared mutation)', async () => {
        seedBlob();
        const first = setup(base({ persistence: { persist: false } }));
        await first.whenReady;
        const second = setup(base({ persistence: { persist: false } }));
        await second.whenReady;

        second.addMessages('de', 'common', { hi: 'Servus' });
        expect(second.translateKey('common', 'hi')).toBe('Servus');
        expect(first.translateKey('common', 'hi')).toBe('Hallo'); // untouched
    });

    it('does not resurrect a seed once the document seed is cleared', async () => {
        seedBlob();
        const first = setup(base());
        await first.whenReady;
        expect(first.locale).toBe('de');

        resetDocumentSeed(); // a new document
        const other = setup(base({ persistence: false }));
        await other.whenReady;
        expect(other.ssrHydrated).toBe(false);
        expect(other.locale).toBe('en'); // detection again
    });

    it('transferMessages:false takes the locale only (the resumable page)', async () => {
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };

        const store = setup(base({ persistence: { transferMessages: false, persist: false }, load: undefined }));
        await store.whenReady;

        expect(store.ssrHydrated).toBe(true);
        expect(store.locale).toBe('de');
        expect(store.translateKey('common', 'hi')).toBe('hi'); // catalogs never transferred
    });
});

describe('SSR seed marks catalogs loaded (no client refetch)', () => {
    it('does not re-fetch namespaces the server already sent', async () => {
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': {
                locale: 'de',
                messages: { en: { common: { hi: 'Hi' } }, de: { common: { hi: 'Hallo' } } }
            }
        };
        const load = vi.fn(async () => ({}));
        const store = setup(base({ supported: ['en', 'de'], namespaces: ['common'], load }));
        await store.whenReady;
        await flush();

        expect(store.ssrHydrated).toBe(true);
        expect(store.translateKey('common', 'hi')).toBe('Hallo');
        expect(load).not.toHaveBeenCalled(); // seeded (locale + fallback) → no fetch
    });
});

describe('initialMessages (SSR preload)', () => {
    it('seeds catalogs synchronously and never calls the loader for them', async () => {
        const load = vi.fn(async () => ({}));
        const store = setup(
            base({
                supported: ['en', 'sv'],
                namespaces: ['home'],
                defaultNamespace: 'home',
                load,
                initialMessages: {
                    en: { home: { hi: 'Hi' } },
                    sv: { home: { hi: 'Hej' } }
                }
            })
        );
        // resolvable immediately — no await needed for the seeded catalogs
        expect(store.translateKey('home', 'hi')).toBe('Hi');
        await store.whenReady;
        await flush();
        expect(load).not.toHaveBeenCalled();

        // a switch to another preloaded locale is instant, still no fetch
        await store.setLocale('sv');
        expect(store.translateKey('home', 'hi')).toBe('Hej');
        expect(load).not.toHaveBeenCalled();
    });
});

describe('no cross-request leak', () => {
    it('keeps two scoped instances fully independent', async () => {
        const a = setup(base({ persistence: false }));
        const b = setup(base({ persistence: false }));
        await Promise.all([a.whenReady, b.whenReady]);

        a.addMessages('en', 'c', { x: 'A' });
        await a.setLocale('sv');

        expect(a.locale).toBe('sv');
        expect(b.locale).toBe('en'); // unaffected
        expect(a.translateKey('c', 'x')).toBe('A');
        expect(b.translateKey('c', 'x')).toBe('x'); // b never got the catalog
    });
});
