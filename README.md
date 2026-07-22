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
