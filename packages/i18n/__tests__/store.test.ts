/** Tests for the reactive @sigx/i18n store (via a real app DI context). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';
import { useI18n, useI18nConfig, type I18nRuntimeConfig } from '../src/store.js';

// These tests exercise core store logic in isolation: detection and persistence
// (Phase 2) are disabled by default so the initial locale is deterministically
// the fallback and no state leaks between tests via localStorage.
function setup(config: I18nRuntimeConfig) {
    const full: I18nRuntimeConfig = { detect: false, persistence: false, ...config };
    const app = defineApp(jsx('div', {}));
    app.defineProvide(useI18nConfig, () => full);
    const store = app.runWithContext(() => useI18n());
    return { app, store };
}

beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __SIGX_ASYNC__?: unknown }).__SIGX_ASYNC__;
});

const flush = () => new Promise(r => setTimeout(r, 0));

describe('store — translation + reactivity', () => {
    it('translates injected messages and reacts to setLocale', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        store.addMessages('en', 'common', { hi: 'Hi' });
        store.addMessages('sv', 'common', { hi: 'Hej' });

        const seen: string[] = [];
        const stop = effect(() => seen.push(store.translateKey('common', 'hi')));
        expect(seen).toEqual(['Hi']);

        await store.setLocale('sv');
        expect(store.locale).toBe('sv');
        expect(seen).toEqual(['Hi', 'Hej']);
        stop.stop();
    });

    it('falls back to the master locale reactively when a key is untranslated', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        store.addMessages('en', 'common', { only_en: 'English' });
        store.addMessages('sv', 'common', {});
        await store.setLocale('sv');
        expect(store.translateKey('common', 'only_en')).toBe('English');
    });

    it('negotiates unsupported locales down to a supported one', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        await store.setLocale('sv-FI');
        expect(store.locale).toBe('sv');
        await store.setLocale('fr');
        expect(store.locale).toBe('en'); // no French → master
    });

    it('emits localeChanged with locale + prev', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        const spy = vi.fn();
        store.localeChanged.subscribe(spy);
        await store.setLocale('sv');
        expect(spy).toHaveBeenCalledWith({ locale: 'sv', prev: 'en' });
    });
});

describe('store — lazy namespace loading', () => {
    it('loads a namespace via the loader on ensureNamespace, once', async () => {
        const load = vi.fn(async (locale: string, ns: string) => ({
            greet: locale === 'sv' ? 'Hej' : 'Hi',
            _ns: ns
        }));
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], load });

        await store.ensureNamespace('cart');
        expect(store.translateKey('cart', 'greet')).toBe('Hi');
        // en (active==fallback) loaded once
        expect(load).toHaveBeenCalledTimes(1);

        await store.ensureNamespace('cart'); // idempotent
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('loads active + fallback locale on setLocale and keeps translating', async () => {
        const load = vi.fn(async (locale: string) => ({ greet: locale === 'sv' ? 'Hej' : 'Hi' }));
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], namespaces: ['common'], load });

        await store.ensureNamespace('common');
        await store.setLocale('sv');
        await flush();
        expect(store.translateKey('common', 'greet')).toBe('Hej');
    });
});

describe('store — missing-key warnings', () => {
    it('stays silent for a missing key while a load is in flight, warns once after', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let release!: () => void;
        const gate = new Promise<Record<string, never>>(r => {
            release = () => r({});
        });
        const { store } = setup({
            fallbackLocale: 'en',
            supported: ['en'],
            namespaces: ['common'],
            load: () => gate // never resolves until released → inflight stays > 0
        });

        // During loading: reading a missing key must NOT warn (normal async window).
        store.translateKey('common', 'nope');
        expect(warn).not.toHaveBeenCalled();

        release();
        await store.whenReady;
        await new Promise(r => setTimeout(r, 0));

        // After loads settle: a genuinely missing key warns exactly once (deduped).
        expect(store.translateKey('common', 'nope')).toBe('nope');
        store.translateKey('common', 'nope');
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('store — hierarchical namespaces', () => {
    it('resolves keys under a nested namespace path', () => {
        const { store } = setup({ fallbackLocale: 'en' });
        store.addMessages('en', 'admin/users', { title: 'Users' });
        expect(store.translateKey('admin/users', 'title')).toBe('Users');
    });
});
