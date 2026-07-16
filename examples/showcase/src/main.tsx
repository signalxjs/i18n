import { defineApp } from 'sigx';
import { createI18n } from '@sigx/i18n';
import { i18nDirectives } from '@sigx/i18n/dom';
import { App } from './App';

defineApp(<App />)
    .use(
        createI18n({
            fallbackLocale: 'en',
            supported: ['en', 'sv'],
            // Default scope for un-targeted reads; the panels override per-target.
            target: 'common',
            defaultNamespace: 'nav',
            targets: {
                app: { extends: 'common' },
                marketing: { extends: 'common' },
                common: {}
            },
            namespaces: ['nav'],
            // url (?lang=sv) > cookie > browser; the chosen locale persists to localStorage.
            detection: { order: ['url', 'cookie', 'browser'] },
            persistence: { storageKey: 'sigx:i18n:showcase' },
            // Vite includes every matching JSON; each (target, locale, ns) is its own chunk.
            load: (target, locale, ns) => import(`./locales/${target}/${locale}/${ns}.json`)
        })
    )
    .use(i18nDirectives())
    .mount('#app');
