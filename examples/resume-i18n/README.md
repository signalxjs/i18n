# @sigx/i18n — resumability example

**A localized page that ships no component JavaScript.** The server renders every
string, the browser gets a delegation loader, and translation costs nothing until
something actually needs to change in the browser.

This mirrors [`signalxjs/core`'s `examples/resume`](https://github.com/signalxjs/core/tree/main/examples/resume),
with the i18n questions answered: where the locale is decided, how you switch it
without JavaScript, what happens when a translated boundary upgrades, and how a
server function replies in the caller's language.

## Run

```sh
pnpm install
pnpm --filter @sigx/i18n build      # examples use the built dist

pnpm --filter @sigx/i18n-resume-example dev     # http://localhost:3000
# or the production build:
pnpm --filter @sigx/i18n-resume-example build
pnpm --filter @sigx/i18n-resume-example start
pnpm --filter @sigx/i18n-resume-example smoke   # 15 assertions over the prod build
```

Try `/?lang=sv`, then remove the query param — the cookie keeps you in Swedish.

## The four things it shows

### 1 — Locale switching with zero JavaScript

The switch is a **server round trip**, and under resumability that is not a
compromise, it is the correct design:

- a resumed QRL handler is runtime-free — it cannot call `useI18n()`;
- and even if it could, every boundary that never hydrates would keep its
  old-language text.

So the switcher is a plain `<a>` built with `localeSwitchUrl`, the server
negotiates with `resolveRequestLocale`, re-renders the document, and persists the
choice with `localeCookie` (see `server.mjs`). Every boundary on the page is
correct because every boundary was rendered fresh.

```tsx
<a href={localeSwitchUrl(url, 'sv')}>SV</a>
```

### 2 — Translated copy that costs nothing

`<Blurb>` in `App.tsx` has no event handlers, so the transform makes no boundary
out of it. Its strings — including the locale-aware number and date — were
resolved once on the server and stay plain HTML forever. This is where most of an
app's translated text should live.

Note the `<ServerGreeting label={t.askServer()} />` usage too: the button's label
doesn't depend on client state, so it is translated on the server and travels as
a serialized prop. The boundary never needs a translator of its own.

### 3 — A translated boundary that upgrades

`resume/Counter.tsx` is the case that genuinely needs i18n in the browser: the
label is a **plural of the live count**, so it cannot be pre-translated into a
prop. Clicking loads the tiny QRL handler chunk; the write upgrades the boundary;
the component chunk loads, setup re-runs, and `useTranslation()` re-translates —
in the browser, in the page's language.

That last step needs config, and **a resumable page has no client app**:
`@sigx/resume` hydrates an upgraded boundary directly, so nothing ever installed
`createI18n` in the browser. `src/i18n.ts` therefore ends with

```ts
provideI18nConfig(i18nOptions());
```

which the Counter's chunk pulls in by importing that module. It costs nothing on
load — the chunk only exists after the first write.

Verified in a browser: on `?lang=sv`, `0 klick` → `1 klick`; on `?lang=en`,
`0 clicks` → `1 click` (the singular form chosen client-side, after the upgrade).

### 4 — A localized server function

`api.server.ts` builds a translator once with `createRequestT` and binds it per
request, so `greet()` answers in the caller's language:

```
{"data":"Hello Ada, this reply was translated on the server. … [en]"}
{"data":"Hej Ada, det här svaret översattes på servern. … [sv]"}
```

Its `mail` namespace is declared `serverOnly` on the Vite plugin, so it lives in
`virtual:sigx-i18n/server-catalogs` and is **not in the client build at all** —
the smoke test asserts that. Because the catalogs are inlined as code rather than
read off disk, this path has no `node:` import anywhere, which is what makes it
usable on an edge runtime.

## What loads, honestly

On first paint the page loads **two** scripts: the generated resume loader, and
the `sigx` runtime chunk — on the 0.12 line the generated loader entry statically
imports one binding from it. No page code, no component code, and **no catalogs**.

On the first click of the counter: the handler chunk (~0.06 kB), the resume
runtime, the `Counter` chunk, and the one catalog it needs — `counter`, not
`page`, because namespaces load only when a component that uses them renders.

`persistence: { transferMessages: false }` is why no catalogs sit in the transfer
blob: this page ships no component JS on load, so they would be bytes nothing
reads — every string is already in the HTML. The **locale** still transfers, so a
boundary that upgrades knows what language it is in.

## Not covered here

- **"Only the loader *executes* on load."** Proving that needs JS-coverage
  instrumentation in a real browser; that machinery lives in core's own
  `examples/resume/smoke.mjs`. This example's smoke asserts what it can actually
  observe over HTTP and in the built artifacts, and says so.
- **Edge deployment wiring** (`vite.config.cloudflare.ts`, `wrangler.jsonc`). The
  `SigxAdapter` seam — `sigx({ ssr: { adapter: cloudflare() } })` — is not in the
  published `@sigx/vite@0.12`; it lands on the 0.13 line. The i18n half is ready
  and tested (`@sigx/i18n/server` is `node:`-free, catalogs arrive as a virtual
  module, and the smoke asserts no `node:` import in the server build), so the
  adapter wiring is a small follow-up once that ships.
