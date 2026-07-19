# Changelog

All notable changes to `@sigx/i18n` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed / removed
- **Removed the "target" axis.** The model is now `messages[locale][namespace]`.
  Lazy namespace loading already gives the per-surface payload split targets were
  for (a namespace loads only when first used). Use **hierarchical namespace
  names** (`admin/users`) for organisation. Dropped `setTarget`/`loadTarget`,
  `extends`, `{ target }` options, and the target level from the store, loader
  (`load(locale, ns)`), server translator, manifest, and generated `Schema`.
- **Removed the `use:t` directive and the `@sigx/i18n/dom` entry.** It could
  freeze the renderer under (dynamically-mounted component + async loader +
  `setLocale`). The `<T>` component (in the core entry) and the accessor cover the
  same ground, are renderer-agnostic, and are the recommended bindings.

### Added
- **`initialMessages` config (SSR preload seed):** `messages[locale][namespace]`
  catalogs seeded synchronously at store creation and marked loaded. The idiomatic
  SSR pattern: the server preloads a request's catalogs and passes them here, so
  the render stays **synchronous** (no async boundaries → server/client VNode trees
  match → hydration wires events cleanly), while `ssrState` still transfers them.
- **Real SignalX SSR example** (`examples/showcase-ssr`): renders actual
  components (`useTranslation`/`useLocale`/`<T>`) on the server via
  `@sigx/server-renderer`, transfers state through `ssrState`, and hydrates on the
  client — plus a server-only `/mail` route using `@sigx/i18n/server`.
- **Universal `<T>` component:** moved into the core `@sigx/i18n` entry (was in
  `/dom`). It renders text as a child and uses only `@sigx/runtime-core`, so it
  works on any sigx renderer (DOM, lynx, terminal, SSR) — on lynx place it inside
  a `<text>` host.
- **Custom detector injection:** `DetectionOptions.detectors?: Detector[]` puts
  app-supplied detectors first — how non-web runtimes (lynx/terminal) inject a
  native locale source through the same `Detector` interface.
- Initial `@sigx/i18n` package: reactive localization for SignalX.
  - Core store (`createI18n`, `useI18n`, `useTranslation`) built on `@sigx/store`.
  - Master locale with automatic fallback + BCP-47 locale fallback chain.
  - Namespaces with lazy per-`(locale, namespace)` loading (hierarchical names
    like `admin/users` for per-surface organisation).
  - Lightweight pluggable formatter (`{var}` interpolation, `Intl` plurals /
    number / date), swappable for a full ICU pack.
  - Locale detection resolver chain (settings, browser, cookie, URL).
  - Persistence + SSR state transfer via `@sigx/store` `persist` / `ssrState`.
  - `@sigx/i18n/server`: non-reactive `createServerT()` for mail/jobs.
  - `@sigx/i18n/vite`: typed-keys `.d.ts` codegen + missing-translation build
    gate + locale HMR.

### Dependencies
- Peer dependencies target the **0.12** SignalX runtime: `@sigx/reactivity`,
  `@sigx/runtime-core`, `@sigx/vite`, and `sigx` at `>=0.12.0 <0.13.0`;
  `@sigx/store` at `>=0.9.0 <0.10.0`.
