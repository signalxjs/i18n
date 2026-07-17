import { defineApp } from 'sigx';
import { createI18n } from '@sigx/i18n';
import { i18nDirectives } from '@sigx/i18n/dom';
import { App } from './App';

// Eagerly-globbed catalog loaders — Vite maps every existing JSON to a lazy
// import. Looking a path up (instead of a bare `import(dynamic)`) means a
// missing (target, locale, ns) — e.g. a namespace that only lives in one target,
// probed via the `extends` chain — resolves to an empty catalog instead of
// throwing Vite's "Unknown variable dynamic import".
const catalogs = import.meta.glob('./locales/**/*.json');
const loadCatalog = (target: string, locale: string, ns: string) => {
    const loader = catalogs[`./locales/${target}/${locale}/${ns}.json`];
    return loader ? loader() : Promise.resolve({});
};

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
            // Each existing (target, locale, ns) is its own lazy chunk; missing
            // combos resolve empty so the fallback chain stays quiet.
            load: loadCatalog
        })
    )
    .use(i18nDirectives())
    .mount('#app');
