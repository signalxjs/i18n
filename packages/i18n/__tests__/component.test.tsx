/** Tests for the universal <T> translation component (mounted app). */
import { describe, it, expect, beforeEach } from 'vitest';
import { component, defineApp } from 'sigx';
import { createI18n } from '../src/plugin.js';
import { useI18n } from '../src/store.js';
import { T } from '../src/index.js';
import type { I18nOptions } from '../src/plugin.js';

const opts: I18nOptions = {
    fallbackLocale: 'en',
    supported: ['en', 'sv'],
    detect: false,
    persistence: false,
    defaultNamespace: 'cart'
};

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('<T> component', () => {
    it('renders translated text and updates on setLocale', async () => {
        const Root = component(() => () => (
            <div>
                <T k="hi" />
                {' | '}
                <T k="items" params={{ count: 3 }} />
            </div>
        ));

        const app = defineApp((<Root />) as never);
        app.use(createI18n(opts));
        const store = app.runWithContext(() => useI18n());
        store.addMessages('en', 'cart', { hi: 'Hi', items: { one: '# item', other: '# items' } });
        store.addMessages('sv', 'cart', { hi: 'Hej', items: { one: '# vara', other: '# varor' } });

        const container = document.createElement('div');
        document.body.appendChild(container);
        app.mount(container);
        await tick();

        expect(container.textContent).toContain('Hi');
        expect(container.textContent).toContain('3 items');

        await store.setLocale('sv');
        await tick();
        expect(container.textContent).toContain('Hej');
        expect(container.textContent).toContain('3 varor');
    });

    it('renders rich components (function form)', async () => {
        const Root = component(() => () => (
            <div>
                <T k="legal" components={{ a: c => <a href="/terms">{c}</a> }} />
            </div>
        ));
        const app = defineApp((<Root />) as never);
        app.use(createI18n(opts));
        const store = app.runWithContext(() => useI18n());
        store.addMessages('en', 'cart', { legal: 'Read our <a>terms</a> now' });

        const container = document.createElement('div');
        document.body.appendChild(container);
        app.mount(container);
        await tick();

        const link = container.querySelector('a');
        expect(link).not.toBeNull();
        expect(link?.getAttribute('href')).toBe('/terms');
        expect(link?.textContent).toBe('terms');
        expect(container.textContent).toContain('Read our');
        expect(container.textContent).toContain('now');
    });

    it('resolves a hierarchical namespace via the ns prop', async () => {
        const Root = component(() => () => <T k="title" ns="admin/users" />);
        const app = defineApp((<Root />) as never);
        app.use(createI18n(opts));
        const store = app.runWithContext(() => useI18n());
        store.addMessages('en', 'admin/users', { title: 'Users' });

        const container = document.createElement('div');
        document.body.appendChild(container);
        app.mount(container);
        await tick();
        expect(container.textContent).toContain('Users');
    });
});
