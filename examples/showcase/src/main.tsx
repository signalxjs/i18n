import { defineApp } from 'sigx';
import { createI18n, type LocaleLoader } from '@sigx/i18n';
import { App } from './App';

// Vite maps every existing catalog to a lazy import; each `<locale>/<ns>.json`
// (namespaces may be nested, e.g. `en/app/dashboard.json`) is its own chunk.
// A namespace loads only when a component that uses it renders → per-surface
// payload split, no target axis needed.
const catalogs = import.meta.glob('./locales/**/*.json');
const loadCatalog: LocaleLoader = (locale, ns) => {
    const loader = catalogs[`./locales/${locale}/${ns}.json`];
    return (loader ? loader() : Promise.resolve({})) as ReturnType<LocaleLoader>;
};

defineApp(<App />)
    .use(
        createI18n({
            fallbackLocale: 'en',
            supported: ['en', 'sv'],
            defaultNamespace: 'nav',
            // Only truly-global namespaces are eager; section namespaces load on use.
            namespaces: ['nav'],
            detection: { order: ['url', 'cookie', 'browser'] },
            persistence: { storageKey: 'sigx:i18n:showcase' },
            load: loadCatalog
        })
    )
    .mount('#app');
