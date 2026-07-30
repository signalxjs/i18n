/** Tests for the reactive @sigx/i18n store (via a real app DI context). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { effect, toRaw } from '@sigx/reactivity';
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

describe('store — runtime keys: per-call default + hasKey', () => {
    it('returns the call-site default instead of echoing the key, without warning', () => {
        // mockClear: an earlier test in this file spies on console.warn without
        // restoring it, so a fresh spy would inherit its call history.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warn.mockClear();
        const onMissing = vi.fn(() => 'GLOBAL');
        const { store } = setup({ fallbackLocale: 'en', onMissing });
        store.addMessages('en', 'content', { known: 'Known' });

        expect(store.translateKey('content', 'block.a1b2.label', undefined, { default: 'Your name' })).toBe('Your name');
        // An explicit fallback means the miss is expected — no global handler, no warning.
        expect(onMissing).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        // Without one, the configured handler still runs.
        expect(store.translateKey('content', 'block.a1b2.label')).toBe('GLOBAL');
        expect(onMissing).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    // The default IS the author's source text, so it must go through the same
    // formatter a catalog string would — otherwise a CMS block authored as
    // "Hi {name}" renders with the token visible to the end user.
    it('formats the call-site default with params, like any other message', () => {
        const { store } = setup({ fallbackLocale: 'en' });
        expect(store.translateKey('content', 'nope', { name: 'Sam' }, { default: 'Hi {name}' })).toBe('Hi Sam');
        expect(store.translateKey('content', 'nope', { n: 1200 }, { default: 'Count: {n, number}' })).toBe(
            'Count: 1,200'
        );
    });

    it('prefers a real translation over the default, and interpolates it', () => {
        const { store } = setup({ fallbackLocale: 'en' });
        store.addMessages('en', 'content', { greet: 'Hi {name}' });
        expect(store.translateKey('content', 'greet', { name: 'Sam' }, { default: 'fallback' })).toBe('Hi Sam');
    });

    it('hasKey reports resolvability through the fallback chain, side-effect free', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        warn.mockClear();
        const onMissing = vi.fn(() => 'GLOBAL');
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], onMissing });
        store.addMessages('en', 'content', { only_en: 'English' });
        store.addMessages('sv', 'content', { sv_only: 'Svenska' });

        expect(store.hasKey('content', 'only_en')).toBe(true);
        expect(store.hasKey('content', 'nope')).toBe(false);
        expect(onMissing).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();

        await store.setLocale('sv');
        expect(store.hasKey('content', 'sv_only')).toBe(true);
        expect(store.hasKey('content', 'only_en')).toBe(true); // via the master fallback
        warn.mockRestore();
    });

    it('hasKey is reactive to locale changes', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'] });
        store.addMessages('en', 'content', {});
        store.addMessages('sv', 'content', { sv_only: 'Svenska' });

        const seen: boolean[] = [];
        const stop = effect(() => seen.push(store.hasKey('content', 'sv_only')));
        expect(seen).toEqual([false]);
        await store.setLocale('sv');
        expect(seen).toEqual([false, true]);
        stop.stop();
    });
});

describe('store — invalidate', () => {
    it('refetches an already-loaded pair so a publish lands without a reload', async () => {
        let published = 'v1';
        const load = vi.fn(async () => ({ title: published }));
        const { store } = setup({ fallbackLocale: 'en', load });

        await store.ensureNamespace('content');
        expect(store.translateKey('content', 'title')).toBe('v1');
        expect(load).toHaveBeenCalledTimes(1);

        // Without invalidate the pair is cached for the store's lifetime.
        await store.ensureNamespace('content');
        expect(load).toHaveBeenCalledTimes(1);

        published = 'v2';
        await store.invalidate('en', 'content');
        expect(load).toHaveBeenCalledTimes(2);
        expect(store.translateKey('content', 'title')).toBe('v2');
    });

    it('narrows by locale and namespace, and takes everything with no arguments', async () => {
        const load = vi.fn(async () => ({ title: 'T' }));
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], load });
        await store.ensureNamespace('content');
        await store.ensureNamespace('nav');
        await store.setLocale('sv');
        await flush();
        const base = load.mock.calls.length;

        await store.invalidate('en', 'content'); // one pair
        expect(load).toHaveBeenCalledTimes(base + 1);

        const afterPair = load.mock.calls.length;
        await store.invalidate('sv'); // every namespace of one locale
        expect(load.mock.calls.length).toBe(afterPair + 2);

        const afterLocale = load.mock.calls.length;
        await store.invalidate(); // everything currently cached
        expect(load.mock.calls.length).toBeGreaterThan(afterLocale + 2);
    });

    it('serves the stale catalog until the refetch lands (no flash of raw keys)', async () => {
        let release!: (c: Record<string, string>) => void;
        const load = vi
            .fn()
            .mockResolvedValueOnce({ title: 'v1' })
            .mockImplementationOnce(() => new Promise(r => (release = r)));
        const { store } = setup({ fallbackLocale: 'en', load });

        await store.ensureNamespace('content');
        const pending = store.invalidate('en', 'content');
        await flush(); // the loader is invoked inside the promise chain
        expect(store.translateKey('content', 'title')).toBe('v1'); // still the old copy
        release({ title: 'v2' });
        await pending;
        expect(store.translateKey('content', 'title')).toBe('v2');
    });

    it('drops a superseded in-flight result instead of resurrecting it', async () => {
        let releaseFirst!: (c: Record<string, string>) => void;
        const load = vi
            .fn()
            .mockImplementationOnce(() => new Promise(r => (releaseFirst = r)))
            .mockResolvedValue({ title: 'fresh' });
        const { store } = setup({ fallbackLocale: 'en', load });

        const first = store.ensureNamespace('content'); // in flight, not yet resolved
        await flush(); // the loader is invoked inside the promise chain
        const invalidated = store.invalidate('en', 'content');
        releaseFirst({ title: 'stale' }); // the superseded request finally answers
        await Promise.all([first, invalidated]);
        await flush();

        expect(store.translateKey('content', 'title')).toBe('fresh');
    });

    it('is a no-op without a loader, so injected catalogs are not orphaned', async () => {
        const { store } = setup({ fallbackLocale: 'en' });
        store.addMessages('en', 'content', { title: 'Injected' });
        await store.invalidate();
        expect(store.translateKey('content', 'title')).toBe('Injected');
    });
});

describe('store — surfaced load failures', () => {
    it('reports the failure through onLoadError and loadError, and recovers on retry', async () => {
        const boom = new Error('offline');
        const load = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue({ title: 'Recovered' });
        const onLoadError = vi.fn();
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError });

        await store.ensureNamespace('content');
        await flush();

        expect(onLoadError).toHaveBeenCalledWith(boom, { locale: 'en', namespace: 'content' });
        expect(store.loadError).toEqual({ error: boom, locale: 'en', namespace: 'content' });
        // The raw rejection survives intact — it is never put through a proxy.
        expect(store.loadError?.error).toBe(boom);

        await store.retry();
        expect(store.translateKey('content', 'title')).toBe('Recovered');
        expect(store.loadError).toBeNull();
    });

    it('logs to the console only when no onLoadError is configured', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const load = vi.fn().mockRejectedValue(new Error('offline'));

        const withHandler = setup({ fallbackLocale: 'en', load, onLoadError: vi.fn() }).store;
        await withHandler.ensureNamespace('content');
        await flush();
        expect(error).not.toHaveBeenCalled();

        const without = setup({ fallbackLocale: 'en', load }).store;
        await without.ensureNamespace('content');
        await flush();
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it('exposes loadError reactively', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ title: 'ok' });
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError: vi.fn() });

        const seen: (string | null)[] = [];
        const stop = effect(() => seen.push(store.loadError ? 'error' : null));
        expect(seen).toEqual([null]);

        await store.ensureNamespace('content');
        await flush();
        expect(seen).toEqual([null, 'error']);

        await store.retry();
        await flush();
        expect(seen).toEqual([null, 'error', null]);
        stop.stop();
    });

    // A failed pair is in neither `loaded` nor `inflight`, so an invalidate that
    // only walked those two would silently skip it — leaving a transient failure
    // unrecoverable without an explicit retry().
    it('invalidate also refetches a pair whose last load failed', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ title: 'Recovered' });
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError: vi.fn() });

        await store.ensureNamespace('content');
        await flush();
        expect(store.loadError).not.toBeNull();

        await store.invalidate('en', 'content');
        expect(store.translateKey('content', 'title')).toBe('Recovered');
        expect(store.loadError).toBeNull();
    });

    // Failures are tracked per pair, so a recovery landing out of order cannot
    // leave `loadError` pointing at a pair that has since succeeded.
    it('keeps loadError on the still-failing pair when another recovers', async () => {
        const failA = new Error('A offline');
        const failB = new Error('B offline');
        const load = vi.fn(async (_l: string, ns: string) => {
            if (ns === 'a') throw failA;
            if (ns === 'b') throw failB;
            return {};
        });
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError: vi.fn() });

        await store.ensureNamespace('a');
        await flush();
        await store.ensureNamespace('b');
        await flush();
        expect(store.loadError?.error).toBe(failB); // newest failure

        // Recover ONLY b, leaving a untouched and still broken — the case a
        // single "last error" gets wrong, since it has no reason to re-stamp a.
        load.mockImplementation(async () => ({ title: 'B ok' }));
        await store.invalidate('en', 'b');
        await flush();

        expect(store.translateKey('b', 'title')).toBe('B ok');
        expect(store.loadError?.error).toBe(failA); // NOT the recovered b
        expect(store.loadError?.namespace).toBe('a');

        // And once a recovers too, the error clears.
        await store.invalidate('en', 'a');
        await flush();
        expect(store.loadError).toBeNull();
    });

    // A loader that throws synchronously (a guard clause, a bad namespace) must
    // land on the same path as a rejection. Otherwise the throw escapes
    // `loadOne` before any promise exists — and since `useTranslation` calls
    // `void store.ensureNamespace(ns)` during setup, it would crash the render.
    it('handles a loader that throws synchronously like any other failure', async () => {
        const boom = new Error('bad namespace');
        const load = vi.fn(() => {
            throw boom;
        });
        const onLoadError = vi.fn();
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError });

        await expect(store.ensureNamespace('content')).resolves.toBeUndefined();
        await flush();

        expect(onLoadError).toHaveBeenCalledWith(boom, { locale: 'en', namespace: 'content' });
        expect(store.loadError?.error).toBe(boom);

        // …and it is retryable, exactly like a rejection.
        load.mockReturnValue({ title: 'Recovered' } as never);
        await store.retry();
        expect(store.translateKey('content', 'title')).toBe('Recovered');
        expect(store.loadError).toBeNull();
    });

    it('keeps a failed pair unloaded so retry actually refetches', async () => {
        const load = vi.fn().mockRejectedValue(new Error('offline'));
        const { store } = setup({ fallbackLocale: 'en', load, onLoadError: vi.fn() });
        await store.ensureNamespace('content');
        await flush();
        const after = load.mock.calls.length;
        await store.retry();
        expect(load.mock.calls.length).toBe(after + 1);
    });
});

describe('store — layered catalogs', () => {
    /** A base catalog with several keys, so "override one, keep the rest" is meaningful. */
    const base = { title: 'Cart', empty: 'Nothing here', checkout: 'Checkout', help: 'Need help?' };

    it('overrides individual keys and leaves the rest of the base intact', () => {
        // The bug #30 is about: a second registration used to WIPE the other keys.
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', base);
        store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });

        expect(store.translateKey('cart', 'title')).toBe('Basket');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');
        expect(store.translateKey('cart', 'checkout')).toBe('Checkout');
        expect(store.translateKey('cart', 'help')).toBe('Need help?');
    });

    it('is order-independent — override first, then base, gives the same result', () => {
        // Previously whichever source registered first marked the pair loaded and
        // silently suppressed the other, so the winner depended on async timing.
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });
        store.addMessages('en', 'cart', base);

        expect(store.translateKey('cart', 'title')).toBe('Basket');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');
    });

    it('seeds whole layers from config — the bulk form', () => {
        const { store } = setup({
            fallbackLocale: 'en',
            layers: ['base', 'tenant'],
            initialMessages: { en: { cart: base } },
            layerMessages: { tenant: { en: { cart: { title: 'Basket' } } } }
        });
        expect(store.translateKey('cart', 'title')).toBe('Basket');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');
    });

    it('setLayer swaps a whole layer, and dropping a key falls back to the layer below', () => {
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', base);
        store.setLayer('tenant', { en: { cart: { title: 'Basket', empty: 'All clear' } } });
        expect(store.translateKey('cart', 'title')).toBe('Basket');
        expect(store.translateKey('cart', 'empty')).toBe('All clear');

        // A narrower override: `empty` is gone, so the base shows through again.
        store.setLayer('tenant', { en: { cart: { title: 'Trolley' } } });
        expect(store.translateKey('cart', 'title')).toBe('Trolley');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');

        // Emptying the layer entirely restores the base for every key.
        store.setLayer('tenant', {});
        expect(store.translateKey('cart', 'title')).toBe('Cart');
    });

    it('applies layers WITHIN a locale, so the locale chain still wins', async () => {
        // Precedence: locale outer, layer inner. A base message in the requested
        // locale beats a tenant override that exists only in a fallback locale —
        // otherwise a partly-translated override drags text back to the master.
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', { title: 'Cart' });
        store.addMessages('sv', 'cart', { title: 'Kundvagn' });
        store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });

        await store.setLocale('sv');
        expect(store.translateKey('cart', 'title')).toBe('Kundvagn'); // sv base, not en tenant

        // …but a tenant override in the ACTIVE locale does win.
        store.addMessages('sv', 'cart', { title: 'Korgen' }, { layer: 'tenant' });
        expect(store.translateKey('cart', 'title')).toBe('Korgen');
    });

    it('loads each layer independently, so neither suppresses the other', async () => {
        const seen: string[] = [];
        const { store } = setup({
            fallbackLocale: 'en',
            layers: ['base', 'tenant'],
            loaders: {
                base: async (_l, ns) => {
                    seen.push(`base:${ns}`);
                    return base;
                },
                tenant: async (_l, ns) => {
                    seen.push(`tenant:${ns}`);
                    return { title: 'Basket' };
                }
            }
        });
        await store.ensureNamespace('cart');
        await flush();

        expect(seen.sort()).toEqual(['base:cart', 'tenant:cart']);
        expect(store.translateKey('cart', 'title')).toBe('Basket');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');
    });

    it('invalidate can be narrowed to one layer', async () => {
        const calls: string[] = [];
        const { store } = setup({
            fallbackLocale: 'en',
            layers: ['base', 'tenant'],
            loaders: {
                base: async () => {
                    calls.push('base');
                    return base;
                },
                tenant: async () => {
                    calls.push('tenant');
                    return { title: 'Basket' };
                }
            }
        });
        await store.ensureNamespace('cart');
        await flush();
        calls.length = 0;

        await store.invalidate('en', 'cart', 'tenant');
        expect(calls).toEqual(['tenant']); // the base was not refetched
    });

    it('explain reports which (layer, locale) supplied a message', async () => {
        const { store } = setup({ fallbackLocale: 'en', supported: ['en', 'sv'], layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', base);
        store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });

        expect(store.explain('cart', 'title')).toEqual({ layer: 'tenant', locale: 'en' });
        expect(store.explain('cart', 'empty')).toEqual({ layer: 'base', locale: 'en' });
        expect(store.explain('cart', 'nope')).toBeNull();

        // Through the locale chain: sv has nothing, so it resolves in en.
        await store.setLocale('sv');
        expect(store.explain('cart', 'title')).toEqual({ layer: 'tenant', locale: 'en' });
    });

    it('costs nothing when no layers are declared — the catalog passes through by identity', () => {
        const { store } = setup({ fallbackLocale: 'en' });
        const catalog = { cart: { title: 'Cart' } };
        store.addMessages('en', 'shop', catalog);
        // Single layer ⇒ no compose, no copy. `state.messages` is a deep reactive
        // proxy, so unwrap it to compare identity rather than the wrapper.
        expect(toRaw(store.messages.en.shop)).toBe(catalog);
        // The observable consequence: the nested shape survives untouched,
        // where a composed catalog would be flattened to dotted keys.
        expect(Object.keys(toRaw(store.messages.en.shop))).toEqual(['cart']);
    });

    it('is reactive when a layer changes', () => {
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'] });
        store.addMessages('en', 'cart', base);

        const seen: string[] = [];
        const stop = effect(() => seen.push(store.translateKey('cart', 'title')));
        expect(seen).toEqual(['Cart']);

        store.addMessages('en', 'cart', { title: 'Basket' }, { layer: 'tenant' });
        expect(seen).toEqual(['Cart', 'Basket']);
        stop.stop();
    });
});

describe('store — setLayer supersedes in-flight loads', () => {
    it('drops a load that resolves after the layer was swapped', async () => {
        // Without a generation bump the orphaned request lands `writeLayer` and
        // quietly reinstates the tree that setLayer had just replaced — the same
        // race `invalidate` guards against.
        let release!: (c: Record<string, string>) => void;
        const { store } = setup({
            fallbackLocale: 'en',
            layers: ['base', 'tenant'],
            loaders: {
                base: async () => ({ title: 'Cart', empty: 'Nothing here' }),
                tenant: () => new Promise(r => (release = r))
            }
        });

        const pending = store.ensureNamespace('cart');
        await flush(); // the loaders are invoked inside the promise chain

        store.setLayer('tenant', { en: { cart: { title: 'Trolley' } } });
        expect(store.translateKey('cart', 'title')).toBe('Trolley');

        release({ title: 'STALE' }); // the superseded request finally answers
        await pending;
        await flush();

        expect(store.translateKey('cart', 'title')).toBe('Trolley');
        expect(store.translateKey('cart', 'empty')).toBe('Nothing here');
    });
});

describe('store — layer misconfiguration is loud, not silent', () => {
    // Only `layers` is consulted when resolving, so a name outside it writes to a
    // tree nothing reads: no error, no effect. These are the assumptions the key
    // space and the composer rest on, so they warn rather than fail quietly.
    const spyWarn = () => {
        const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
        w.mockClear();
        return w;
    };

    it('warns when defaultLayer is not one of the declared layers', () => {
        const warn = spyWarn();
        setup({ fallbackLocale: 'en', layers: ['base', 'tenant'], defaultLayer: 'typo' });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('defaultLayer "typo" is not in layers'));
        warn.mockRestore();
    });

    it('warns when a layer name contains a space, which the load key cannot survive', () => {
        const warn = spyWarn();
        setup({ fallbackLocale: 'en', layers: ['base', 'my tenant'] });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('contains a space'));
        warn.mockRestore();
    });

    it('warns when a loader names a layer that will never be consulted', () => {
        const warn = spyWarn();
        setup({ fallbackLocale: 'en', layers: ['base'], loaders: { ghost: async () => ({}) } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('loaders["ghost"]'));
        warn.mockRestore();
    });

    it('warns when setLayer names an undeclared layer', () => {
        const warn = spyWarn();
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'] });
        warn.mockClear();
        store.setLayer('nope', { en: { cart: { title: 'X' } } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('setLayer("nope")'));
        warn.mockRestore();
    });

    it('stays quiet for a correct configuration', () => {
        const warn = spyWarn();
        const { store } = setup({ fallbackLocale: 'en', layers: ['base', 'tenant'], defaultLayer: 'base' });
        store.setLayer('tenant', { en: { cart: { title: 'Basket' } } });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('store — setLayer clears a stuck error state', () => {
    it('clears the failure for the layer it replaces', async () => {
        // Without this, `loadError` stayed set forever: the caller has supplied
        // the layer's contents, and `retry()` could not clear it either because
        // `writeLayer` marks the pair loaded, so `loadOne` short-circuits before
        // reaching `clearFailure`.
        const { store } = setup({
            fallbackLocale: 'en',
            layers: ['base', 'tenant'],
            loaders: {
                base: async () => ({ title: 'Cart' }),
                tenant: async () => {
                    throw new Error('tenant service down');
                }
            },
            onLoadError: vi.fn()
        });

        await store.ensureNamespace('cart');
        await flush();
        expect(store.loadError).toMatchObject({ namespace: 'cart' });

        store.setLayer('tenant', { en: { cart: { title: 'Basket' } } });
        expect(store.loadError).toBeNull();
        expect(store.translateKey('cart', 'title')).toBe('Basket');

        // …and retry() has nothing left to do rather than resurrecting it.
        await store.retry();
        await flush();
        expect(store.loadError).toBeNull();
    });
});
