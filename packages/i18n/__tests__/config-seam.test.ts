/**
 * The app-less config seam — the resumability path.
 *
 * `@sigx/resume` upgrades a boundary by hydrating its component directly, with
 * no client app (its own comment: "app-less pages need no explicit client
 * bootstrap"). So a boundary that translates against client-changing state has
 * no DI scope to resolve `useI18nConfig` from, and `provideI18nConfig` is how
 * the config reaches it — from a module the boundary's chunk imports.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineApp, jsx } from '@sigx/runtime-core';
import { createI18n, provideI18nConfig, type I18nOptions } from '../src/plugin.js';
import { useI18n } from '../src/store.js';

const options = (over: Partial<I18nOptions> = {}): I18nOptions => ({
    fallbackLocale: 'en',
    supported: ['en', 'sv'],
    detect: false,
    persistence: false,
    initialMessages: { en: { common: { hi: 'Hi' } }, sv: { common: { hi: 'Hej' } } },
    ...over
});

/** Resolve the store the way an upgraded boundary does: no app installed it. */
const resolveWithoutPlugin = () => defineApp(jsx('div', {})).runWithContext(() => useI18n());

afterEach(() => {
    delete globalThis.__SIGX_I18N_CONFIG__;
});

describe('provideI18nConfig', () => {
    it('lets the store resolve with no plugin installed', async () => {
        provideI18nConfig(options());
        const store = resolveWithoutPlugin();
        await store.whenReady;
        expect(store.translateKey('common', 'hi')).toBe('Hi');
    });

    it('serves the locale the seam carries', async () => {
        provideI18nConfig(options({ initialLocale: 'sv' }));
        const store = resolveWithoutPlugin();
        await store.whenReady;
        expect(store.locale).toBe('sv');
        expect(store.translateKey('common', 'hi')).toBe('Hej');
    });

    it('throws a message naming both fixes when nothing provided config', () => {
        expect(() => resolveWithoutPlugin()).toThrow(/createI18n|provideI18nConfig/);
    });

    it('is overridden by an app-level plugin install', async () => {
        provideI18nConfig(options({ initialLocale: 'sv' }));
        const app = defineApp(jsx('div', {}));
        app.use(createI18n(options({ initialLocale: 'en' })));
        const store = app.runWithContext(() => useI18n());
        await store.whenReady;
        expect(store.locale).toBe('en'); // the app's config wins over the seam
    });

    it('is a no-op off a live client, so SSR requests cannot share a config', () => {
        // A process-wide config would leak `detection.context` (request headers)
        // from one SSR request into the next.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).window;
        try {
            provideI18nConfig(options());
            expect(globalThis.__SIGX_I18N_CONFIG__).toBeUndefined();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('provideI18nConfig'));
        } finally {
            if (original) Object.defineProperty(globalThis, 'window', original);
            warn.mockRestore();
        }
    });
});
