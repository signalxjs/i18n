/** Tests for the useTranslation proxy accessor + createI18n plugin + useLocale. */
import { describe, it, expect, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { computed, effect } from '@sigx/reactivity';
import { createI18n, type I18nOptions } from '../src/plugin.js';
import { useTranslation, useLocale } from '../src/accessor.js';
import { useI18n } from '../src/store.js';

const opts = (over: Partial<I18nOptions> = {}): I18nOptions => ({
    fallbackLocale: 'en',
    supported: ['en', 'sv'],
    detect: false,
    persistence: false,
    ...over
});

/** Build an app with the plugin installed and resolve the store + a translator. */
function scenario(over: Partial<I18nOptions> = {}) {
    const app = defineApp(jsx('div', {}));
    app.use(createI18n(opts(over)));
    return app.runWithContext(() => {
        const store = useI18n();
        return { store, t: useTranslation('cart'), locale: useLocale() };
    });
}

beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __SIGX_ASYNC__?: unknown }).__SIGX_ASYNC__;
});

describe('accessor — three forms are equivalent', () => {
    it('t(key,params) === t.a.b(params) === String(t.a.b) === `${t.a.b}`', () => {
        const { store, t } = scenario();
        store.addMessages('en', 'cart', {
            summary: { title: 'Your cart' },
            items: { one: '# item', other: '# items' }
        });

        expect(t('summary.title')).toBe('Your cart');
        expect(t.summary.title()).toBe('Your cart');
        expect(String(t.summary.title)).toBe('Your cart');
        expect(`${t.summary.title}`).toBe('Your cart');

        expect(t.items({ count: 3 })).toBe('3 items');
        expect(t('items', { count: 1 })).toBe('1 item');
    });

    it('falls back to the master locale through the accessor', async () => {
        const { store, t, locale } = scenario();
        store.addMessages('en', 'cart', { only_en: 'English' });
        store.addMessages('sv', 'cart', {});
        await locale.setLocale('sv');
        expect(t.only_en()).toBe('English');
    });
});

describe('accessor — reactivity', () => {
    it('the callable form re-runs a computed on locale change', async () => {
        const { store, t, locale } = scenario();
        store.addMessages('en', 'cart', { hi: 'Hi' });
        store.addMessages('sv', 'cart', { hi: 'Hej' });

        const c = computed(() => t.hi());
        expect(c.value).toBe('Hi');
        await locale.setLocale('sv');
        expect(c.value).toBe('Hej');
    });

    it('the bare-coercion form re-runs an effect on locale change', async () => {
        const { store, t, locale } = scenario();
        store.addMessages('en', 'cart', { hi: 'Hi' });
        store.addMessages('sv', 'cart', { hi: 'Hej' });

        const seen: string[] = [];
        const stop = effect(() => seen.push(`${t.hi}`)); // template-literal coercion
        expect(seen).toEqual(['Hi']);
        await locale.setLocale('sv');
        expect(seen).toEqual(['Hi', 'Hej']);
        stop.stop();
    });
});

describe('accessor is renderer-safe (regression: mistaken for a vnode)', () => {
    it('hides framework/promise probe keys and is neither thenable nor iterable', () => {
        const { t } = scenario();
        const node = t.some.nested.key as unknown as Record<PropertyKey, unknown>;
        // A sigx renderer probes object children for these; the node must not
        // answer with a child (which made it look like a vnode and crashed render).
        expect(node.then).toBeUndefined();
        expect(node.$$typeof).toBeUndefined();
        expect(node.nodeType).toBeUndefined();
        expect((node as { [Symbol.iterator]?: unknown })[Symbol.iterator]).toBeUndefined();
        expect(() => Promise.resolve(node as unknown)).not.toThrow();
        // …but it still resolves as a string via call + coercion.
        expect(typeof (t.some.nested.key as unknown as () => string)()).toBe('string');
        expect(typeof `${t.some.nested.key}`).toBe('string');
    });
});

describe('useLocale controls', () => {
    it('exposes a reactive locale + setLocale', async () => {
        const { locale } = scenario();
        expect(locale.locale).toBe('en');
        await locale.setLocale('sv');
        expect(locale.locale).toBe('sv');
    });
});

describe('useTranslation on a hierarchical namespace', () => {
    it('resolves keys under a nested namespace path', () => {
        const app = defineApp(jsx('div', {}));
        app.use(createI18n(opts()));
        const { store, t } = app.runWithContext(() => {
            const store = useI18n();
            return { store, t: useTranslation('admin/users') };
        });
        store.addMessages('en', 'admin/users', { title: 'Users' });
        expect(t.title()).toBe('Users');
    });
});

describe('lazy namespace load via useTranslation', () => {
    it('triggers a loader fetch for the requested namespace', async () => {
        const seen: string[] = [];
        const load = async (_l: string, ns: string) => {
            seen.push(ns);
            return { greeting: 'Hello' };
        };
        const app = defineApp(jsx('div', {}));
        app.use(createI18n(opts({ load })));
        const { store, t } = app.runWithContext(() => {
            const store = useI18n();
            return { store, t: useTranslation('greetings') };
        });
        await store.whenReady;
        await Promise.resolve();
        expect(seen).toContain('greetings');
        expect(t.greeting()).toBe('Hello');
    });
});
