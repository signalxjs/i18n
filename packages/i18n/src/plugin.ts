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
