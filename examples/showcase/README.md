# @sigx/i18n — SPA showcase

A single-page app demonstrating every client-side feature of `@sigx/i18n`.

## Run

```sh
pnpm install
pnpm build                                   # build @sigx/i18n first (examples use the built dist)
pnpm --filter @sigx/i18n-showcase-example dev
```

Then open <http://localhost:5173>.

## What it shows

- **Many concurrent targets** — a `marketing` panel and an `app` panel rendered
  together, each lazy-loading only its own JSON, both sharing a `common` base via
  `extends`.
- **All accessor forms** — bare `t.nav.home`, callable `t.nav.home()`, string-key
  `t('home')`, and params `t.nav.greeting({ name })`.
- **`<T>` component** (universal) incl. rich interpolation via `components`.
- **`use:t` directive** (DOM-only convenience).
- **Plurals / number / date** via the lightweight formatter.
- **Master fallback** — any key missing in Swedish falls back to English.
- **Detection** — `?lang=sv` (URL) or a cookie or the browser language.
- **Persistence** — the chosen locale is saved to `localStorage` and restored on
  reload.

## The build gate

`vite.config.ts` wires the `@sigx/i18n/vite` plugin. Try deleting a key from
`src/locales/sv/**` (e.g. remove `"cta"` from `marketing/sv/home.json`) and run:

```sh
pnpm --filter @sigx/i18n-showcase-example build
```

The build **fails** with a precise report of the missing key — the same gate you
get in CI via `sigx-i18n check`.
