/** Tests for the reactive @sigx/i18n store (via a real app DI context). */
import { describe, it, expect, vi } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { effect } from '@sigx/reactivity';
import { useI18n, useI18nConfig, type I18nRuntimeConfig } from '../src/store.js';

function setup(config: I18nRuntimeConfig) {
    const app = defineApp(jsx('div', {}));
    app.defineProvide(useI18nConfig, () => config);
    const store = app.runWithContext(() => useI18n());
    return { app, store };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('store — translation + reactivity', () => {
    it('translates injected messages and reacts to setLocale', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        store.addMessages('', 'en', 'common', { hi: 'Hi' });
        store.addMessages('', 'sv', 'common', { hi: 'Hej' });

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
        store.addMessages('', 'en', 'common', { only_en: 'English' });
        store.addMessages('', 'sv', 'common', {});
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
        const load = vi.fn(async (_t: string, locale: string, ns: string) => ({
            greet: locale === 'sv' ? 'Hej' : 'Hi',
            _ns: ns
        }));
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], load });

        await store.ensureNamespace('cart');
        expect(store.translateKey('cart', 'greet')).toBe('Hi');
        // en (active==fallback) loaded once for the default target
        expect(load).toHaveBeenCalledTimes(1);

        await store.ensureNamespace('cart'); // idempotent
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('loads active + fallback locale on setLocale and keeps translating', async () => {
        const load = vi.fn(async (_t: string, locale: string) => ({ greet: locale === 'sv' ? 'Hej' : 'Hi' }));
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], namespaces: ['common'], load });

        await store.ensureNamespace('common');
        await store.setLocale('sv');
        await flush();
        expect(store.translateKey('common', 'greet')).toBe('Hej');
    });
});

describe('store — targets', () => {
    it('resolves through the extends base and switches target', async () => {
        const { store } = setup({
            fallbackLocale: 'en',
            targets: { admin: { extends: 'common' }, common: {} }
        });
        store.addMessages('common', 'en', 'nav', { home: 'Home' });
        store.addMessages('admin', 'en', 'nav', { dash: 'Dashboard' });

        expect(store.translateKey('nav', 'home', undefined, 'admin')).toBe('Home'); // via extends
        await store.setTarget('admin');
        expect(store.target).toBe('admin');
        expect(store.translateKey('nav', 'dash')).toBe('Dashboard');
    });
});
