<div align="center">

# @sigx/i18n

**Reactive localization for [SignalX](https://sigx.dev/core/).**

Namespaces · master-locale fallback · API-defined targets · SSR-safe · typed keys · easy UI binding

</div>

> 🚧 SignalX is in early public release (`0.x`). APIs may change between minor
> versions until `1.0`.

## 📚 Documentation

Full guides, API reference and live examples → **<https://sigx.dev/i18n/>**

## Install

```sh
pnpm add @sigx/i18n
```

`@sigx/i18n` peers on the sigx runtime (`@sigx/reactivity`, `@sigx/runtime-core`)
and `@sigx/store`. The `./dom` entry additionally needs `@sigx/runtime-dom` +
`sigx`; `./vite` needs `vite` + `@sigx/vite`.

## Quick start

```ts
import { defineApp } from 'sigx';
import { createI18n, useTranslation } from '@sigx/i18n';

const app = defineApp(Root).use(createI18n({
  fallbackLocale: 'en',
  supported: ['en', 'sv', 'de'],
  load: (target, locale, ns) => import(`./locales/${target}/${locale}/${ns}.json`),
}));

// in a component
const t = useTranslation('cart');
t.summary.title            // bare form — reads as the translated string
t.items({ count: 3 })      // callable form — interpolation / plural params
t('items', { count: 3 })   // string-key form — no build plugin required
```

## Packages / entries

| Entry | Purpose |
|---|---|
| `@sigx/i18n` | core store, `t`/`useTranslation`, formatter, detectors, plugin |
| `@sigx/i18n/dom` | `<T>` component + `use:t` directive |
| `@sigx/i18n/server` | non-reactive `createServerT()` for mail templates & jobs |
| `@sigx/i18n/vite` | typed-keys codegen + missing-translation build gate + HMR |

## License

MIT © Andreas Ekdahl
