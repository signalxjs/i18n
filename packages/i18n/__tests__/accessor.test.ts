/** Tests for the useTranslation proxy accessor + createI18n plugin + useLocale. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { computed, effect } from '@sigx/reactivity';
import { createI18n, type I18nOptions } from '../src/plugin.js';
import { useTranslation, useDynamicTranslation, useLocale } from '../src/accessor.js';
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

    it('surfaces a load failure and clears it on retry', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ hi: 'Hi' });
        const app = defineApp(jsx('div', {}));
        app.use(createI18n(opts({ load, namespaces: ['cart'], onLoadError: vi.fn() })));
        const locale = app.runWithContext(() => useLocale());

        await locale.whenReady;
        await new Promise(r => setTimeout(r, 0));
        expect(locale.error).toMatchObject({ locale: 'en', namespace: 'cart' });

        await locale.retry();
        expect(locale.error).toBeNull();
    });
});

describe('useDynamicTranslation — the untyped-key escape hatch', () => {
    /** Resolve a dynamic translator for the runtime-sourced `content` namespace. */
    function dynamicScenario(over: Partial<I18nOptions> = {}) {
        const app = defineApp(jsx('div', {}));
        app.use(createI18n(opts(over)));
        return app.runWithContext(() => ({
            store: useI18n(),
            content: useDynamicTranslation('content')
        }));
    }

    it('translates a key computed at runtime, with params', () => {
        const { store, content } = dynamicScenario();
        store.addMessages('en', 'content', { 'block.a1b2.label': 'Hi {name}' });
        const key = ['block', 'a1b2', 'label'].join('.'); // not a literal at any call site
        expect(content(key, { name: 'Sam' })).toBe('Hi Sam');
    });

    it('renders the author’s original text when the key has no translation', () => {
        const { content } = dynamicScenario();
        expect(content('block.zz.label', undefined, { default: 'Your full name' })).toBe('Your full name');
        // …and echoes the key when no default is offered, as before.
        expect(content('block.zz.label')).toBe('block.zz.label');
    });

    it('exists() probes without resolving, and is a real property (not a message key)', () => {
        const { store, content } = dynamicScenario();
        store.addMessages('en', 'content', { known: 'Known', exists: 'A message actually named exists' });

        expect(content.exists('known')).toBe(true);
        expect(content.exists('nope')).toBe(false);
        // The regression this API shape exists to prevent: a catalog key literally
        // named `exists` must still be reachable, and must not shadow the probe.
        expect(typeof content.exists).toBe('function');
        expect(content('exists')).toBe('A message actually named exists');
    });

    it('is reactive on locale change', async () => {
        const { store, content } = dynamicScenario();
        store.addMessages('en', 'content', { hi: 'Hi' });
        store.addMessages('sv', 'content', { hi: 'Hej' });

        const seen: string[] = [];
        const stop = effect(() => seen.push(content('hi')));
        expect(seen).toEqual(['Hi']);
        await store.setLocale('sv');
        expect(seen).toEqual(['Hi', 'Hej']);
        stop.stop();
    });

    it('registers the namespace as active, so it loads lazily like useTranslation', async () => {
        const seen: string[] = [];
        const load = async (_l: string, ns: string) => {
            seen.push(ns);
            return { title: 'Loaded' };
        };
        const { store, content } = dynamicScenario({ load });
        await store.whenReady;
        await Promise.resolve();
        expect(seen).toContain('content');
        expect(content('title')).toBe('Loaded');
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
