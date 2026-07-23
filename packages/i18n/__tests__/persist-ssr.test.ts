/** Tests for @sigx/i18n detection + persistence + SSR transfer through the store. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { useI18n, useI18nConfig, type I18nRuntimeConfig } from '../src/store.js';

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
    it('seeds locale + messages from the server blob and skips detection', async () => {
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };

        const store = setup(base());
        await store.whenReady;

        expect(store.ssrHydrated).toBe(true);
        expect(store.locale).toBe('de'); // server seed overrides detection
        expect(store.translateKey('common', 'hi')).toBe('Hallo');
    });

    it('seeds EVERY store instance — the island #2 case', async () => {
        // @sigx/store 0.11.0 stopped consuming the transfer entry (store#70), so
        // this no longer needs a repair here. It matters because every
        // @sigx/ssr-islands island root is its own component tree, and each
        // separately-upgraded @sigx/resume boundary can be: under the old
        // consume-once default island #2 onward rendered the WRONG LANGUAGE and
        // refetched catalogs the server had already serialized into the blob it
        // had just discarded.
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };

        const first = setup(base());
        await first.whenReady;
        const second = setup(base());
        await second.whenReady;

        expect(second.ssrHydrated).toBe(true);
        expect(second.locale).toBe('de');
        expect(second.translateKey('common', 'hi')).toBe('Hallo');
    });

    it('gives each instance its own catalog tree', async () => {
        // Store copies the seed per instance, so one instance's addMessages
        // cannot reach another's — they are independent by design.
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };

        const first = setup(base());
        await first.whenReady;
        first.addMessages('de', { common: { hi: 'Servus' } });

        const second = setup(base());
        await second.whenReady;
        expect(second.translateKey('common', 'hi')).toBe('Hallo');
    });

    it('transferMessages:false takes the locale only (the resumable page)', async () => {
        // A resumable page ships no component JS on load, so catalogs in the
        // blob would be bytes nothing reads — the server already rendered every
        // string into the HTML. Only the locale needs to cross.
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', messages: { de: { common: { hi: 'Hallo' } } } }
        };

        const store = setup(base({ persistence: { transferMessages: false, persist: false }, load: undefined }));
        await store.whenReady;

        expect(store.ssrHydrated).toBe(true);
        expect(store.locale).toBe('de');                     // locale still transfers
        expect(store.translateKey('common', 'hi')).toBe('hi'); // catalogs did not
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
