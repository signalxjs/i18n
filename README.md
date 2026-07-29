<div align="center">

# @sigx/i18n

**Reactive localization for [SignalX](https://sigx.dev/core/).**

Namespaces · master-locale fallback · lazy-loaded · SSR-safe · typed keys · easy UI binding

</div>

> 🚧 SignalX is in early public release (`0.x`). APIs may change between minor
> versions until `1.0`.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/i18n/>**

## Install

```sh
pnpm add @sigx/i18n
```

`@sigx/i18n` peers on the sigx runtime (`@sigx/reactivity`, `@sigx/runtime-core`),
`@sigx/store`, and `sigx` (for the `<T>` component). `./vite` needs `vite` +
`@sigx/vite`; `./server` has no sigx dependency.

## Quick start

```ts
import { defineApp } from 'sigx';
import { createI18n, useTranslation } from '@sigx/i18n';

const app = defineApp(Root).use(createI18n({
  fallbackLocale: 'en',
  supported: ['en', 'sv', 'de'],
  // Namespaces load lazily on first use; nested paths (admin/users) are fine.
  load: (locale, ns) => import(`./locales/${locale}/${ns}.json`),
}));

// in a component
const t = useTranslation('cart');
t.items({ count: 3 })      // callable form — interpolation / plural params
t('items', { count: 3 })   // string-key form — no build plugin required
t.summary.title            // bare form — coerces to the string (attributes / templates)
```

**In JSX children use the call form** (`{t.summary.title()}`) or the `<T>`
component — a sigx renderer inspects object children as vnodes, so a bare
accessor node can't be a direct child. The bare form is for attributes
(`title={t.summary.title}`) and template literals (`` `${t.user.name}` ``).

## Namespaces + lazy loading (no "targets")

Each namespace's JSON loads **only when a component that uses it first renders**,
so a public surface never downloads an admin-only namespace — the per-surface
payload split is automatic. Organise per-surface strings with **hierarchical
namespace names** (`admin/users`, `public/home`); there is no separate "target"
axis.

## Packages / entries

| Entry | Purpose |
|---|---|
| `@sigx/i18n` | store, `useTranslation` accessor, `<T>` component, formatter, detectors, plugin — the universal binding surface (DOM, lynx, terminal, SSR) |
| `@sigx/i18n/server` | non-reactive `createServerT()` / `createRequestT()` for mail templates, jobs & server functions — **universal** (no `node:` imports, runs on workerd/Deno/Bun) |
| `@sigx/i18n/server/node` | `loadCatalogs(dir)` — the filesystem catalog reader, the one Node-only entry |
| `@sigx/i18n/vite` | typed-keys codegen + missing-translation build gate + HMR + the virtual catalog modules |

**Examples:** `examples/showcase` (SPA), `examples/showcase-ssr` (SSR +
hydration, plus a server-only mail route), `examples/resume-i18n` (resumability:
zero-JS locale switch, a translated boundary that upgrades, a localized server
function).

### Server-side translation, on any runtime

`createServerT` takes catalogs **as data**, so the same call works from a Node
mailer and from a bundled Cloudflare/Deno/Vercel worker:

```ts
// Node — read them off disk
import { createServerT, loadCatalogs } from '@sigx/i18n/server/node';
const t = createServerT({ catalogs: await loadCatalogs('src/locales'), fallbackLocale: 'en' });

// Edge — the Vite plugin inlines them; no filesystem involved
import catalogs from 'virtual:sigx-i18n/server-catalogs';
import { createServerT } from '@sigx/i18n/server';
const t = createServerT({ catalogs, fallbackLocale: 'en', defaultNamespace: 'mail' });
```

Declare which namespaces must never reach the browser on the plugin — they are
dropped from `virtual:sigx-i18n/catalogs` and become the entire content of
`virtual:sigx-i18n/server-catalogs`:

```ts
i18n({ localesDir: 'src/locales', masterLocale: 'en', serverOnly: ['mail', 'jobs/*'] })
```

Add `/// <reference types="@sigx/i18n/virtual" />` to the app's `env.d.ts` to
type both virtual modules.

### Locale-aware server functions

`createRequestT` builds once and binds per request — negotiation runs off the
request's `Accept-Language` / cookie / query, exactly like the client store:

```ts
import { createRequestT } from '@sigx/i18n/server';
import catalogs from 'virtual:sigx-i18n/server-catalogs';

const requestT = createRequestT({ catalogs, fallbackLocale: 'en', supported: ['en', 'sv'] });

export const greet = serverFn(async (rq) => requestT(rq.request).t('hello', { name: 'Ada' }));
```

`@sigx/server` is not imported in either direction — you pass `rq.request`, so
the same helper works from a plain fetch handler in a platform entry.

## SSR, resumability, islands, edge

| Capability | Status | What you use |
|---|---|---|
| **Classic SSR + hydration** | ✅ | `createI18n` + `initialMessages`; state transfers via `@sigx/store`'s `ssrState`. See `examples/showcase-ssr` |
| **Resumability** (`@sigx/resume`) | ✅ | Server-round-trip locale switch (`localeSwitchUrl` + `localeCookie`); `provideI18nConfig` for boundaries that upgrade. See `examples/resume-i18n` |
| **Islands** (`@sigx/ssr-islands`) | ✅ | Nothing to configure — every island root gets the document's locale and catalogs |
| **Server functions** (`@sigx/server`) | ✅ | `createRequestT` — pass `rq.request` |
| **Edge runtimes** (workerd, Deno, Bun) | ✅ | `@sigx/i18n/server` is `node:`-free; catalogs via `virtual:sigx-i18n/server-catalogs` |

Only `@sigx/i18n/server/node` (the fs catalog reader) and `@sigx/i18n/vite`
(build tooling) import `node:` — a test enforces that for every other module.

### Switching locale on a resumable page

Use a **server round trip**. This is not a workaround, it is the correct design
under resumability:

- a resumed QRL handler is runtime-free, so it cannot call `useI18n()`;
- and every boundary that never hydrates would keep its old-language text.

```tsx
<a href={localeSwitchUrl(url, 'sv')}>SV</a>
```

The server negotiates with `resolveRequestLocale(request, …)`, renders the whole
document in that locale, and persists the choice with `localeCookie(locale)`.
Every boundary is correct because every boundary was re-rendered — including the
ones that will never load a chunk.

Set `persistence: { transferMessages: false }` on such a page: it ships no
component JS on load, so catalogs in the transfer blob are bytes nothing reads.
The locale still transfers.

### What a resumed handler may capture

Inside a resume module (`*.resume.tsx` or a `resume/` directory), reading `t` in
the **render** is free — that is how the server HTML is produced:

```tsx
// ✅ extracts: the handler captures only the named signal
const count = ctx.signal(0);
return () => <button onClick={() => count.value++}>{t.label({ count: count.value })}</button>;
```

**Capturing** `t`, `useI18n()`, or the store in a handler does not — they are
setup helpers, so the whole component falls back to wake-on-interaction (with a
build-time warning naming the capture):

```tsx
// ❌ not extractable — `t` is a setup helper
<button onClick={() => (msg.value = t.saved())}>save</button>
```

Translate it in the render, or pass the translated string in as a prop.

### Translating in a boundary that upgrades

A boundary whose text depends on state that changes client-side (a plural of a
live count) must re-translate in the browser. But a resumable page has **no
client app** — `@sigx/resume` hydrates an upgraded boundary directly, so nothing
installed `createI18n` there. Put the config where that boundary's chunk can find
it:

```ts
// src/i18n.ts — imported by the app entry AND by resumable components
export const options = { fallbackLocale: 'en', supported: ['en', 'sv'], load };
provideI18nConfig(options);   // client-only; a no-op on the server
```

It costs nothing on load: the module reaches the browser only through those
components' chunks, which load on first upgrade and never before.

## Works on any sigx renderer (incl. lynx)

The accessor and `<T>` render *text* and depend only on `@sigx/runtime-core`, so
they run on every sigx renderer unchanged. On **lynx**, place them inside a
`<text>` host (like all lynx text), inject a native-locale detector, and pass
`@sigx/lynx-storage` for persistence:

```tsx
// lynx — call form as a JSX child; place inside a <text> host
<text>{t.cart.title()}</text>
<text><T k="cart.items" params={{ count }} /></text>

app.use(createI18n({
  fallbackLocale: 'en',
  supported: ['en', 'sv'],
  detection: { detectors: [{ name: 'native', detect: () => readDeviceLocale() }] },
  persistence: { storage: Storage /* from @sigx/lynx-storage */ },
  load: (locale, ns) => import(`./locales/${locale}/${ns}.json`),
}));
```

## License

MIT © Andreas Ekdahl
