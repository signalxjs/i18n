/**
 * The `createI18n` app plugin.
 *
 * `app.use(createI18n({ … }))` provides the i18n config at app level; the store
 * itself is created lazily on the first `useI18n()`/`useTranslation()` during
 * render, so under SSR it is constructed inside the request render and its
 * `ssrState` registration attaches to the correct per-request context.
 *
 * DOM bindings (`<T>` + `use:t`) live in `@sigx/i18n/dom` and register
 * separately, keeping this core entry free of a `@sigx/runtime-dom` dependency.
 */

import type { App, Plugin } from '@sigx/runtime-core';
import { isLiveClient } from '@sigx/runtime-core/internals';
import { useI18nConfig, type I18nRuntimeConfig } from './store.js';

/** Public options for `createI18n` — the resolved runtime config (formatter optional). */
export type I18nOptions = I18nRuntimeConfig;

/**
 * Create the i18n plugin. Install it with `app.use(createI18n(options))`.
 *
 * ```ts
 * const app = defineApp(Root).use(createI18n({
 *   fallbackLocale: 'en',
 *   supported: ['en', 'sv'],
 *   load: (target, locale, ns) => import(`./locales/${target}/${locale}/${ns}.json`),
 * }));
 * ```
 */
export function createI18n(options: I18nOptions): Plugin {
    return {
        name: 'i18n',
        install(app: App): void {
            app.defineProvide(useI18nConfig, () => options);
        }
    };
}

/**
 * Make the config available with **no app** — the resumability case.
 *
 * `@sigx/resume` upgrades a boundary by hydrating its component directly; there
 * is no client app, so nothing installed `createI18n` and DI has nothing to
 * resolve. Call this from a module that the translating boundary's chunk
 * imports, and the store finds its config when that chunk finally loads:
 *
 * ```ts
 * // src/i18n.ts — imported by the app entry AND by resumable components
 * export const i18nOptions = { fallbackLocale: 'en', supported: ['en', 'sv'], load };
 * provideI18nConfig(i18nOptions);
 * ```
 *
 * Client-only by design: the config would otherwise be shared by every SSR
 * request in a long-lived server process, and `detection.context` (request
 * headers) is per-request. On the server this is a no-op — install the plugin
 * there, which is per-app and per-request correct.
 */
export function provideI18nConfig(options: I18nOptions): void {
    if (!isLiveClient()) {
        if (__DEV__) {
            console.warn(
                '[@sigx/i18n] provideI18nConfig() was called outside a live client and ignored. ' +
                    'On the server, install the plugin instead (`app.use(createI18n({ … }))`) — a ' +
                    'process-wide config would be shared across every SSR request.'
            );
        }
        return;
    }
    globalThis.__SIGX_I18N_CONFIG__ = options;
}
