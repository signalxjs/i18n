/**
 * Tests for translating into a locale that is NOT the active one — the client
 * half of the server's `forLocale` (issue #32).
 *
 * The property that matters, and the one that is easy to get wrong: a pinned
 * translator is reactive to **its own** catalog arriving and inert with respect
 * to `state.locale`. Both halves are pinned below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { component, defineApp } from 'sigx';
import { jsx } from '@sigx/runtime-core';
import { effect, signal } from '@sigx/reactivity';
import { createI18n, type I18nOptions } from '../src/plugin.js';
import { useI18n, type I18nRuntimeConfig } from '../src/store.js';
import { useTranslation, useDynamicTranslation } from '../src/accessor.js';
import { T } from '../src/index.js';

const opts = (over: Partial<I18nOptions> = {}): I18nRuntimeConfig => ({
    fallbackLocale: 'en',
    supported: ['en', 'sv'],
    detect: false,
    persistence: false,
    ...over
});

/** An app with the plugin installed; everything resolved inside its DI context. */
function setup<R>(over: Partial<I18nOptions>, resolve: () => R): R {
    const app = defineApp(jsx('div', {}));
    app.use(createI18n(opts(over)));
    return app.runWithContext(resolve);
}

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('useTranslation(ns, { locale })', () => {
    it('translates into the pinned locale while the app stays on the active one', () => {
        const { store, t, tSv } = setup({}, () => ({
            store: useI18n(),
            t: useTranslation('cart'),
            tSv: useTranslation('cart', { locale: 'sv' })
        }));
        store.addMessages('en', 'cart', { title: 'Cart' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });

        expect(store.locale).toBe('en');
        expect(t.title()).toBe('Cart');
        // All three call forms, pinned.
        expect(tSv.title()).toBe('Kundvagn');
        expect(tSv('title')).toBe('Kundvagn');
        expect(`${tSv.title}`).toBe('Kundvagn');
    });

    it('is INERT to the active locale — setLocale does not re-run a pinned read', async () => {
        const { store, tSv } = setup({}, () => ({
            store: useI18n(),
            tSv: useTranslation('cart', { locale: 'sv' })
        }));
        store.addMessages('en', 'cart', { title: 'Cart' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });

        const seen: string[] = [];
        const stop = effect(() => seen.push(tSv.title()));
        expect(seen).toEqual(['Kundvagn']);

        await store.setLocale('sv');
        await store.setLocale('en');
        expect(store.locale).toBe('en');
        expect(seen).toEqual(['Kundvagn']); // never re-ran: `state.locale` was never read
        stop.stop();
    });

    it('IS reactive to its own catalog arriving', async () => {
        const { store, tSv } = setup({}, () => ({
            store: useI18n(),
            tSv: useTranslation('cart', { locale: 'sv' })
        }));
        store.addMessages('en', 'cart', { title: 'Cart' });

        const seen: string[] = [];
        const stop = effect(() => seen.push(tSv.title()));
        expect(seen).toEqual(['Cart']); // master fallback while `sv` is still missing

        store.addMessages('sv', 'cart', { title: 'Kundvagn' });
        expect(seen.at(-1)).toBe('Kundvagn');
        stop.stop();
    });

    it('repaints when a pinned catalog LOADS, without touching the active locale', async () => {
        const load = vi.fn(async (locale: string) => ({ title: locale === 'sv' ? 'Kundvagn' : 'Cart' }));
        const { store, tSv } = setup({ load }, () => ({
            store: useI18n(),
            tSv: useTranslation('cart', { locale: 'sv' })
        }));

        const seen: string[] = [];
        const stop = effect(() => seen.push(tSv.title()));
        expect(seen).toEqual(['title']); // nothing loaded yet

        await tick();
        expect(seen.at(-1)).toBe('Kundvagn');
        expect(store.locale).toBe('en'); // no setLocale round trip
        stop.stop();
    });

    it('applies the locale chain from the PINNED locale (sv-FI → sv → master)', () => {
        const { store, t } = setup({ supported: [] }, () => ({
            store: useI18n(),
            t: useTranslation('cart', { locale: 'sv-FI' })
        }));
        store.addMessages('en', 'cart', { title: 'Cart', help: 'Need help?' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });
        store.addMessages('sv-FI', 'cart', {});

        expect(t.title()).toBe('Kundvagn'); // BCP-47 truncation from the pinned locale
        expect(t.help()).toBe('Need help?'); // then the master
    });

    it('pins the dynamic translator too', () => {
        const { store, dyn } = setup({}, () => ({
            store: useI18n(),
            dyn: useDynamicTranslation('content', { locale: 'sv' })
        }));
        store.addMessages('sv', 'content', { 'block.a1.label': 'Namn' });

        expect(dyn('block.a1.label')).toBe('Namn');
        expect(dyn.exists('block.a1.label')).toBe(true);
        expect(dyn.exists('block.zz.label')).toBe(false);
        expect(dyn('block.zz.label', undefined, { default: 'Ditt namn' })).toBe('Ditt namn');
    });
});

describe('store.forLocale — the same shape createServerT().forLocale() returns', () => {
    it('exposes t / exists / forNamespace / dynamic bound to the locale', () => {
        const store = setup({ defaultNamespace: 'cart' }, () => useI18n());
        store.addMessages('en', 'cart', { title: 'Cart' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });

        const sv = store.forLocale('sv');
        expect(sv.locale).toBe('sv');
        expect(sv.t('title')).toBe('Kundvagn');
        expect(sv.exists('title')).toBe(true);
        expect(sv.exists('nope')).toBe(false);
        expect(sv.forNamespace('cart').title()).toBe('Kundvagn');
        expect(sv.dynamic('cart')('title')).toBe('Kundvagn');
        expect(store.locale).toBe('en');
    });

    it('loads the catalog for the pinned locale on first use', async () => {
        const load = vi.fn(async (locale: string, ns: string) => ({ title: `${locale}/${ns}` }));
        const store = setup({ load }, () => useI18n());

        store.forLocale('sv').forNamespace('cart');
        await tick();

        // The pinned locale AND the master (so the fallback is available).
        expect(load.mock.calls.map(([l, ns]) => `${l}/${ns}`).sort()).toEqual(['en/cart', 'sv/cart']);
        expect(store.forLocale('sv').t('title', undefined, { namespace: 'cart' })).toBe('sv/cart');
    });

    it('explains resolution for a pinned locale, layers and all', () => {
        const store = setup({ layers: ['base', 'tenant'] }, () => useI18n());
        store.addMessages('en', 'cart', { title: 'Cart', empty: 'Empty' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });
        store.addMessages('sv', 'cart', { title: 'Korgen' }, { layer: 'tenant' });

        expect(store.forLocale('sv').t('title', undefined, { namespace: 'cart' })).toBe('Korgen');
        expect(store.explain('cart', 'title', 'sv')).toEqual({ layer: 'tenant', locale: 'sv' });
        expect(store.explain('cart', 'empty', 'sv')).toEqual({ layer: 'base', locale: 'en' });
        // The active locale's answer is unchanged.
        expect(store.explain('cart', 'title')).toEqual({ layer: 'base', locale: 'en' });
    });
});

describe('ensureNamespace(ns, locale)', () => {
    it('loads a namespace for another locale without switching to it', async () => {
        const load = vi.fn(async (locale: string, ns: string) => ({ title: `${locale}/${ns}` }));
        const store = setup({ load }, () => useI18n());

        await store.ensureNamespace('cart', 'sv');

        expect(store.locale).toBe('en');
        expect(load.mock.calls.map(([l, ns]) => `${l}/${ns}`).sort()).toEqual(['en/cart', 'sv/cart']);
        expect(store.translateKey('cart', 'title', undefined, { locale: 'sv' })).toBe('sv/cart');
    });

    it('dedupes per (namespace, locale), not per namespace', async () => {
        const load = vi.fn(async (locale: string, ns: string) => ({ title: `${locale}/${ns}` }));
        const store = setup({ load }, () => useI18n());

        await store.ensureNamespace('cart'); // active locale — loads `en` only
        expect(load).toHaveBeenCalledTimes(1);

        await store.ensureNamespace('cart', 'sv'); // already active, but a new locale
        expect(load.mock.calls.map(([l]) => l).sort()).toEqual(['en', 'sv']);

        await store.ensureNamespace('cart', 'sv'); // idempotent
        await store.ensureNamespace('cart');
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('a second caller awaits the IN-FLIGHT load rather than resolving early', async () => {
        // The dedupe belongs to `loadOne`, keyed (layer, locale, ns), which hands
        // back the pending promise. A guard in `ensureNamespace` would return an
        // already-resolved one, and the second caller would render before its
        // catalog existed.
        let release!: () => void;
        const gate = new Promise<void>(r => (release = r));
        const load = vi.fn(async (locale: string) => {
            await gate;
            return { title: `${locale}/cart` };
        });
        const store = setup({ load }, () => useI18n());

        const first = store.ensureNamespace('cart', 'sv'); // in flight, not awaited
        const second = store.ensureNamespace('cart', 'sv'); // must join it

        let secondSettled = false;
        void second.then(() => (secondSettled = true));
        await tick();
        expect(secondSettled).toBe(false); // did NOT resolve ahead of the load

        release();
        await Promise.all([first, second]);
        expect(store.translateKey('cart', 'title', undefined, { locale: 'sv' })).toBe('sv/cart');
        expect(load).toHaveBeenCalledTimes(2); // sv + master, once each
    });

    it('refetches after invalidate — the pair is no longer marked loaded', async () => {
        let published = 'v1';
        const load = vi.fn(async (locale: string) => ({ title: `${locale}:${published}` }));
        const store = setup({ load }, () => useI18n());

        await store.ensureNamespace('cart', 'sv');
        const afterFirst = load.mock.calls.length;

        published = 'v2';
        await store.invalidate('sv', 'cart');
        await store.ensureNamespace('cart', 'sv'); // must not short-circuit

        expect(load.mock.calls.length).toBeGreaterThan(afterFirst);
        expect(store.translateKey('cart', 'title', undefined, { locale: 'sv' })).toBe('sv:v2');
    });

    it('invalidate and retry reach a pinned pair', async () => {
        let published = 'v1';
        const load = vi.fn(async (locale: string) => ({ title: `${locale}:${published}` }));
        const store = setup({ load }, () => useI18n());

        await store.ensureNamespace('cart', 'sv');
        expect(store.translateKey('cart', 'title', undefined, { locale: 'sv' })).toBe('sv:v1');

        published = 'v2';
        await store.invalidate('sv', 'cart');
        expect(store.translateKey('cart', 'title', undefined, { locale: 'sv' })).toBe('sv:v2');
    });
});

describe('<T locale>', () => {
    it('renders the pinned locale and follows a changing locale prop', async () => {
        const load = vi.fn(async (locale: string) => {
            const titles: Record<string, string> = { en: 'Cart', sv: 'Kundvagn', de: 'Warenkorb' };
            return { title: titles[locale] ?? 'Cart' };
        });
        const row = signal('sv');
        const Root = component(() => () => (
            <div>
                <T k="title" />
                {' | '}
                <T k="title" locale={row.value} />
            </div>
        ));

        const app = defineApp((<Root />) as never);
        app.use(createI18n(opts({ load, defaultNamespace: 'cart', supported: ['en', 'sv', 'de'] })));
        const store = app.runWithContext(() => useI18n());

        const container = document.createElement('div');
        document.body.appendChild(container);
        app.mount(container);
        await tick();

        expect(container.textContent).toBe('Cart | Kundvagn');
        expect(store.locale).toBe('en'); // the pinned element did not move the app

        // A changing `locale` prop loads that locale's catalog too.
        row.value = 'de';
        await tick();
        await tick();
        expect(container.textContent).toBe('Cart | Warenkorb');
    });
});
