# Changelog

All notable changes to `@sigx/i18n` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Many concurrent targets:** the store tracks active `(target, namespace)`
  scopes, so several targets load and render at once; `setLocale` reloads every
  active scope. `useTranslation(ns, { target })` / `<T target>` load the target
  they read from.
- **Universal `<T>` component:** moved into the core `@sigx/i18n` entry (was in
  `/dom`). It renders text as a child and uses only `@sigx/runtime-core`, so it
  works on any sigx renderer (DOM, lynx, terminal, SSR) — on lynx place it inside
  a `<text>` host. `/dom` re-exports it for convenience.
- **Custom detector injection:** `DetectionOptions.detectors?: Detector[]` puts
  app-supplied detectors first — how non-web runtimes (lynx/terminal) inject a
  native locale source through the same `Detector` interface.
- Initial `@sigx/i18n` package: reactive localization for SignalX.
  - Core store (`createI18n`, `useI18n`, `useTranslation`) built on `@sigx/store`.
  - Master locale with automatic fallback + BCP-47 locale fallback chain.
  - API-defined **targets** (scopes) with `extends` for a shared base.
  - Namespaces with lazy per-`(target, locale, namespace)` loading.
  - Lightweight pluggable formatter (`{var}` interpolation, `Intl` plurals /
    number / date), swappable for a full ICU pack.
  - Locale detection resolver chain (settings, browser, cookie, URL).
  - Persistence + SSR state transfer via `@sigx/store` `persist` / `ssrState`.
  - `@sigx/i18n/dom`: `<T>` component and isomorphic `use:t` directive.
  - `@sigx/i18n/server`: non-reactive `createServerT()` for mail/jobs.
  - `@sigx/i18n/vite`: typed-keys `.d.ts` codegen + missing-translation build
    gate + locale HMR.
