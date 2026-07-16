# @sigx/i18n — server-side showcase

Server-side localization with **`@sigx/i18n/server`** — localized HTML pages and
an email-template preview, with **no client JavaScript**. Shows the DI-free
server translator, locale negotiation, master fallback, and plurals/number
formatting on the server (the "mail templates / jobs" use case).

## Run

```sh
pnpm install
pnpm build                                        # build @sigx/i18n first
pnpm --filter @sigx/i18n-showcase-ssr-example dev
```

Then:

```sh
curl 'http://localhost:3000/?lang=sv'             # Swedish landing page
curl 'http://localhost:3000/mail?lang=sv&to=Åsa'  # Swedish email preview
curl -H 'Accept-Language: sv' http://localhost:3000/   # header-based detection
```

Or open <http://localhost:3000> and toggle EN/SV.

## What it shows

- **`createServerT()`** — a non-reactive translator with zero sigx/app
  dependency, catalogs read from disk once.
- **Server-only namespace** — `mail` is never shipped to a client bundle.
- **Locale negotiation** — `?lang` → `locale` cookie → `Accept-Language` → master.
- **Master fallback** — the email's `ps` line exists only in `en/mail.json`, so
  the Swedish email falls back to English for that one line.
- **Formatting** — plurals (`users`) and numbers (`credits`) on the server.

> The reactive client story (SSR state transfer via `ssrState`, hydration without
> flash) is covered by the SPA example and the package's unit tests; this example
> focuses on what is uniquely server-side.
