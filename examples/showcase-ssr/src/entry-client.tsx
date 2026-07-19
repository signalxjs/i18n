import { defineApp } from 'sigx';
import { ssrClientPlugin } from '@sigx/server-renderer/client';
import { App } from './App';
import { i18nPlugin } from './i18n';

// Same component tree, same i18n plugin. The store seeds `locale` + `messages`
// from `window.__SIGX_ASYNC__` during creation (before the first render), and
// marks those catalogs loaded — so hydration matches the server HTML with no
// flash and no refetch. The server's locale wins over client detection.
const app = defineApp(<App />);
app.use(i18nPlugin());
app.use(ssrClientPlugin).hydrate!('#app');
