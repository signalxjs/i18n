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
