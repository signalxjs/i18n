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

- **Lazy namespaces** — the `marketing/home` and `app/dashboard` namespaces load
  only when their panel renders. Open the Network panel and click **Reveal app
  section**: `app/dashboard.<locale>.json` is fetched *then*, not on first paint.
- **Hierarchical namespaces** (`marketing/home`, `app/dashboard`) organise
  per-surface strings — no "target" axis.
- **All accessor forms** — callable `t.nav.home()`, string-key `t('home')`, params
  `t.nav.greeting({ name })`, and the bare form in attributes.
- **`<T>` component** incl. rich interpolation via `components`.
- **Plurals / number / date** via the lightweight formatter.
- **Master fallback** — any key missing in Swedish falls back to English.
- **Detection** — `?lang=sv` (URL) or a cookie or the browser language.
- **Persistence** — the chosen locale is saved to `localStorage` and restored on
  reload.

## The build gate

`vite.config.ts` wires the `@sigx/i18n/vite` plugin. Try deleting a key from
`src/locales/sv/**` (e.g. remove `"cta"` from `marketing/home.json`) and run:

```sh
pnpm --filter @sigx/i18n-showcase-example build
```

The build **fails** with a precise report of the missing key — the same gate you
get in CI via `sigx-i18n check`.
