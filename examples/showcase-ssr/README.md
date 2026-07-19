# @sigx/i18n — SSR showcase

**Real SignalX server-side rendering with `@sigx/i18n`.** The same components
render on the server (to HTML) and hydrate on the client — no string-building,
no re-translate flash. Plus a server-only email route using the DI-free
`@sigx/i18n/server` translator.

## Run

```sh
pnpm install
pnpm --filter @sigx/i18n build          # examples use the built dist
pnpm --filter @sigx/i18n-showcase-ssr-example dev
```

Then open <http://localhost:3000>.

Production:

```sh
pnpm --filter @sigx/i18n-showcase-ssr-example build
pnpm --filter @sigx/i18n-showcase-ssr-example start
```

## What it shows

- **Real component SSR** — `src/App.tsx` is an ordinary SignalX component tree
  (`useTranslation`, `useLocale`, `<T>`). `src/entry-server.tsx` renders it per
  request; `src/entry-client.tsx` hydrates the exact same tree.
- **The server awaits catalogs.** Namespaces requested during render (`home`
  eagerly, `app` on first use) register their load with the render, so the shell
  only emits once translations are resolved — **view-source shows localized HTML**,
  not placeholders.
- **Synchronous render, no boundaries.** The server preloads this request's
  catalogs (`preloadCatalogs`) and hands them to the store as `initialMessages`,
  so the render resolves every string from memory — the server VNode tree matches
  the client's, and hydration wires up events with no mismatch.
- **State transfer + no refetch.** `renderDocument`'s state plugin serializes the
  loaded catalogs + locale into `window.__SIGX_ASYNC__['store:i18n']`. On the
  client the store seeds from it *and marks those catalogs loaded*, so hydration
  matches byte-for-byte and nothing is re-fetched (no flash).
- **Locale detection, server-side.** `?lang=sv` works in dev and prod; production
  also reads `Accept-Language` / `Cookie` (the prod handler passes `req`).
- **Client-side switching** — the EN/SV buttons call `setLocale` and switch
  reactively after hydration. Both locales are seeded from SSR, so the switch is
  instant (no fetch). The `?lang=` links are the SSR path (a full navigation the
  server renders in that locale). A larger app would preload only the active
  locale and lazy-load the rest on switch, as the SPA showcase does.
- **Master fallback** — the sentence from `home.fallbackNote` exists only in
  English; Swedish falls back to it.
- **Plurals / number / date** via the lightweight formatter (`app` namespace).
- **A server-only namespace** — `/mail` (and `/mail?lang=sv`) renders a localized
  email with `@sigx/i18n/server`. Its `mail` catalog is excluded from the client
  loader's glob, so it never ships to the browser.

## Verify the SSR is real

```sh
curl -s 'http://localhost:3000/?lang=sv' | grep -i 'Serverrenderad\|__SIGX_ASYNC__'
```

You should see the Swedish heading **in the initial HTML** and the
`window.__SIGX_ASYNC__ = { "store:i18n": … }` seed — proof the translation ran on
the server, not the client.
