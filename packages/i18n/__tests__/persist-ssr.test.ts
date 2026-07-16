/** Tests for @sigx/i18n detection + persistence + SSR transfer through the store. */
import { describe, it, expect, beforeEach } from 'vitest';
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
    it('seeds locale + messages from the server blob (consume-once) and skips detection', async () => {
        (window as unknown as { __SIGX_ASYNC__: Record<string, unknown> }).__SIGX_ASYNC__ = {
            'store:i18n': { locale: 'de', target: '', messages: { '': { de: { common: { hi: 'Hallo' } } } } }
        };

        const store = setup(base());
        await store.whenReady;

        expect(store.ssrHydrated).toBe(true);
        expect(store.locale).toBe('de'); // server seed overrides detection
        expect(store.translateKey('common', 'hi')).toBe('Hallo');

        // consume-once: a second instance starts from defaults (no leftover seed)
        const store2 = setup(base());
        await store2.whenReady;
        expect(store2.ssrHydrated).toBe(false);
        expect(store2.locale).toBe('en');
    });
});

describe('no cross-request leak', () => {
    it('keeps two scoped instances fully independent', async () => {
        const a = setup(base({ persistence: false }));
        const b = setup(base({ persistence: false }));
        await Promise.all([a.whenReady, b.whenReady]);

        a.addMessages('', 'en', 'c', { x: 'A' });
        await a.setLocale('sv');

        expect(a.locale).toBe('sv');
        expect(b.locale).toBe('en'); // unaffected
        expect(a.translateKey('c', 'x')).toBe('A');
        expect(b.translateKey('c', 'x')).toBe('x'); // b never got the catalog
    });
});
