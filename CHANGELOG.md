# Changelog

All notable changes to `@sigx/i18n` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3] - 2026-08-03

A single-issue patch, and the second lynx-blocking one in a row: the published
bundle contained a byte that QuickJS-family engines refuse to parse, so no lynx
app could load `@sigx/i18n` at all. No API change; the runtime strings are
identical, and `dist/index.js` is marginally smaller.

### Fixed
- **A raw NUL byte no longer ships in `dist/index.js`** (#53). `<T>`'s
  (namespace, locale) cache key was written with a **literal U+0000** pasted into
  the source instead of an escape, and esbuild preserves template-literal raw
  text — so the byte travelled verbatim into the published bundle. Node parses it
  without complaint. QuickJS-family engines do not: PrimJS, which lynx runs its
  background bundle on, treats a raw NUL as end-of-string while tokenizing, so
  **any lynx app that imported `@sigx/i18n` failed to boot at all** —
  `loadCard failed SyntaxError: unexpected end of string`, with no error boundary
  and no fallback, just a dead bundle. `0.3.1` and `0.3.2` are both affected.

  The key is now two compared fields rather than one delimited string, so there
  is no delimiter to get wrong: nothing ever decoded the pair, and joining them
  also allocated a throwaway string on every render of every `<T>` — one per list
  row, per pass. Behaviour is unchanged and `dist/index.js` gets slightly smaller.
  `store.ts`'s `KEY_SEP` keeps its NUL delimiter, which it always spelled as a
  proper escape and which it genuinely needs, since it decodes the key it builds.

### Changed
- **Builds now reject raw control bytes** (#53). `scripts/check-control-bytes.mjs`
  scans `dist/` at the end of the package build — the release workflow builds and
  publishes without running `verify:pack`, so a check that lived only there would
  not have stopped this release — and a vitest guard scans `src/` on every test
  run. Both call the same detector. Run it by hand with `pnpm verify:bytes`.

## [0.3.2] - 2026-08-03

A single-issue patch: `@sigx/i18n` no longer requires an `Intl` global, so plural
keys render on engines that lack one. No API change, and on engines that have
`Intl` the output is identical.

### Fixed
- **`Intl` is no longer assumed to exist** (#54). The default formatter constructed
  `Intl.PluralRules` and `Intl.NumberFormat` unconditionally, so on an engine without
  an `Intl` global — lynx's PrimJS (QuickJS-derived) is one — **every plural lookup
  threw a `ReferenceError`**. The `#` substitution builds a `NumberFormat` on every
  plural lookup whether or not the message contains a `#`, so an entry as plain as
  `{ "minutesAgo": { "one": "#m ago", "other": "#m ago" } }` was enough: it threw
  during render, once per list row, and an error boundary's retry re-entered the same
  render — an unrecoverable screen. `{arg, date}` / `{arg, time}` had the same defect
  via `Intl.DateTimeFormat`.

  Each constructor is now feature-detected and degrades instead of throwing: plurals
  pick `one`/`other` (the existing fallback to `other` still covers a catalog without
  a `one` form), `#` and `{n, number}` render as `String(n)`, and dates and times go
  through `toLocaleDateString`/`toLocaleTimeString`, which those engines do have.
  Output loses locale nuance, but a plural key can no longer take a render down; a
  dev-only warning names each missing constructor once. Detection is per call and
  fallbacks are never cached, so an `Intl` polyfill loaded at any point — before or
  after the module is evaluated — is picked up. Where `Intl` exists, behaviour and
  output are unchanged. `@sigx/i18n/server` shares the formatter and is fixed with it.

### Docs
- **`persistence.storage` no longer claims a default this package doesn't own**
  (#51). The JSDoc said "Default `localStorage`", but `@sigx/i18n` never touches
  `localStorage` — it passes the option straight to `@sigx/store`'s `persist`,
  which resolves the default. Restating someone else's implementation detail as
  our contract meant their probe could change and our docs would silently be
  wrong. Now says what is true: we select no backend, and omitting it defers to
  `@sigx/store`.

  Documented alongside it, both previously unstated and both load-bearing on
  non-DOM renderers: an **async** backend is supported (`StorageLike`'s
  `getItem`/`setItem`/`removeItem` may each return a promise, so
  `@sigx/lynx-storage` works as-is, with hydration awaited and applied as one
  atomic patch), and with
  no Web-Storage-shaped global present persistence **silently no-ops** — the
  locale does not survive a restart and nothing is logged. The README's lynx
  section says the same, plus that `Detector.detect` is synchronous, so an async
  native locale goes through `initialLocale` / `await setLocale()` instead.

## [0.3.1] - 2026-07-31

A single-issue patch: `@sigx/i18n` is now importable from a non-DOM sigx renderer.
Purely a fix — no API change, and DOM apps behave exactly as before.

### Fixed
- **The core entry no longer reaches for the `sigx` umbrella** (#47) — `@sigx/i18n`
  could not be imported at all from a non-DOM renderer. `sigx` is the DOM
  meta-package (its entry is `import '@sigx/runtime-dom/platform'`, and
  `@sigx/runtime-dom` declares `global { namespace JSX { IntrinsicElements … } }`),
  so a single import of `@sigx/i18n` typed **every** JSX element in the consuming
  app against the DOM intrinsics. In a lynx app that turned unrelated, previously
  fine components into type errors (`Property 'bindinput' does not exist on type
  'InputHTMLAttributes<HTMLInputElement>'`). It was also a runtime bug, not only a
  typing one: `dist/index.js` imported `sigx/jsx-runtime`, so `<T>` was built with
  the DOM JSX factory rather than the host renderer's — which fails silently
  instead of at the typecheck.

  Three spellings carried it in, all now renderer-neutral:
  `component.tsx` imported `component`/`Define` from `sigx` (→ `@sigx/runtime-core`);
  the package's `jsxImportSource` was `sigx` (→ `@sigx/runtime-core`); and
  `vite.config.ts` inherited `defineLibConfig`'s `importSource: 'sigx'` default
  (→ set explicitly). With `sigx` out of the program, the declaration emitter also
  stops routing inferred types through it — `InjectableFunction` now resolves to
  `@sigx/runtime-core`, `Computed` to `@sigx/reactivity`.

  No API change: `<T>`, the accessor and the store are untouched, and DOM apps
  behave exactly as before.

### Changed
- `sigx` is no longer listed in `peerDependencies` / `peerDependenciesMeta` (#47).
  It was already `optional` there; now nothing in the published package imports it,
  so the declaration was misleading. It stays a devDependency for the DOM tests.
  Nothing to do on upgrade — an optional peer that was satisfied still is.

### Added
- `edge-clean.test.ts` guards the above (#47): the core entry's source graph must
  contain no bare `sigx` specifier, and both JSX-factory settings are asserted —
  the compiler-injected `jsx()` import is invisible to a source walk, so the
  umbrella could otherwise come back through configuration alone. `verify:pack`
  now installs the renderer-neutral tier **without** `sigx`, so the published
  tarball's import smoke fails to resolve if the umbrella ever returns.

## [0.3.0] - 2026-07-30

Pre-1.0, so the **breaking server-entry change below lands in a minor**. If you
only consume the client entry (`@sigx/i18n`), this release is purely additive;
if you import `@sigx/i18n/server`, read "Changed / removed — BREAKING" before
upgrading.

### Added
- **Translate into a locale other than the active one** (#32) — the client half of
  the server's `forLocale`. A preview pane, a list whose rows each carry their own
  locale, or composing a message in the recipient's language no longer needs
  `setLocale('sv')` → read → `setLocale('en')`, which repaints the whole app, fires
  `localeChanged` twice, and — being async — cannot serve a synchronous render at
  all.

  ```tsx
  const tSv = useTranslation('cart', { locale: 'sv' });   // pinned; app stays on 'en'
  const dyn = useDynamicTranslation('content', { locale: 'sv' });
  <T k="cart.title" locale={row.locale} />
  ```

  A pinned translator reads `messages` reactively — so it repaints when **its**
  catalog lands — and never reads the active locale, so `setLocale` leaves it
  alone. Keys stay typed, `locale` is checked like `setLocale`'s, and the locale
  chain applies from where it was pinned (`sv-FI` → `sv` → master).

  It is literally the server's surface: `store.forLocale('sv')` returns the same
  `BoundTranslator` (`t` / `exists` / `forNamespace` / `dynamic`) that
  `createServerT().forLocale('sv')` does — one shared `bindLocale` factory now
  builds both, so they cannot drift.

  The loading half is public too: `store.ensureNamespace(ns, locale)` takes a
  locale (defaulting to the active one) and dedupes per `(namespace, locale)`, so a
  namespace already loaded for `en` still fetches when a preview asks for it in
  `sv`. `invalidate` and `retry` reach pinned pairs unchanged. Also additive:
  `store.hasKey(ns, key, locale)` and `store.explain(ns, key, locale)`.

- **Layered catalogs** (#30) — override **individual keys** of a catalog you don't
  own. A library ships defaults; a downstream app, or one per-tenant deployment of
  it, changes a handful of strings and everything else keeps coming from the layer
  below — including keys the base gains in a later version.

  Three things made this impossible before, and all three are fixed:
  - `mergeCatalog` **replaced** a whole catalog despite the name, so a second
    registration wiped the other keys.
  - It also marked the pair loaded, so whichever source registered first silently
    suppressed the other — order-dependent on async timing, and untested either
    way. Loads are now keyed `(layer, locale, namespace)`, which removes it.
  - `translate()` had one widening axis (the locale chain) and no notion of
    priority.

  Surface: `layers` (ordered, lowest first), `defaultLayer`, per-layer `loaders`,
  and `layerMessages` for seeding whole trees. Imperatively,
  `store.setLayer(name, tree)` swaps a layer and
  `addMessages(locale, ns, catalog, { layer })` sets one key.
  **The server takes the same layers** (`layers`, `layerCatalogs`, and
  `LocaleTranslator.withLayers` for a per-request tenant), so a white-label string
  is identical in an email and in the UI.

  **Precedence is locale outer, layer inner**: a `base` message in the requested
  locale beats a `tenant` override that exists only in a fallback locale. A
  partly-translated override therefore never drags text back to the master
  language, and a message is still formatted in the locale it was *found* in,
  which plural selection depends on.

  Composition is cached **globally, keyed by catalog identity** through a WeakMap
  trie, so an SSR process serving many requests composes each distinct layer stack
  once rather than per store instance. Identity keying is also what makes a global
  cache safe in a multi-tenant process: one tenant's catalog object can never key
  another's result. The corollary is that a registered catalog must be treated as
  **immutable** — replace it rather than mutating it in place.

  Consumers using no layers are unaffected and pay nothing: a single-layer
  composition returns the catalog **by identity**, with no merge and no allocation.
  The SSR wire shape is unchanged — the server sends the already-layered effective
  view, since the client needs the resolved strings rather than their provenance.
- **`store.explain(namespace, key)`** — which `(layer, locale)` supplied a message.
  With both a locale chain and a layer stack, "why is this string wrong" stops
  being answerable by inspection.
- **`composeCatalogs` / `composeAt` / `layerFor`** (`@sigx/i18n`) — the pure layer
  primitives, in a new sigx-free `layers.ts` shared by the store and the server.
  `flatten` moved here from `manifest.ts` (which imports `node:fs`) and is
  re-exported, so there is one flattener and the server graph stays `node:`-free.
  Both key spellings are normalised before merging, so a flat `{"cart.title"}`
  override shadows a nested `{cart:{title}}` base and vice versa.

### Fixed
- **A test that passed vacuously.** `persist-ssr.test.ts`'s *"gives each instance
  its own catalog tree"* called `addMessages('de', { … })` with the wrong arity,
  writing `tree.de['[object Object]'] = undefined`, so it proved nothing about
  copy isolation. `__tests__` is outside the root `tsconfig` include, so the arity
  error was never caught.

### Changed / removed — BREAKING (server entry)
- **One translation surface for the client and the server** (#42). The server
  translator now *is* the client's translator: bind a locale, then a namespace,
  and you get the identical proxy `useTranslation` returns — typed against the
  same generated `Schema`. A mail template is key-checked like a component, so
  renaming a key in `mail.json` fails the build instead of the email. Previously
  `@sigx/i18n/server` had no `Schema` link at all: every key was a bare `string`.

  The mechanism is a new internal `translator.ts` holding the `Schema`-derived
  types and both translator factories behind one contract:

  ```ts
  interface TranslationSource {
      translateKey(namespace, key, params?, options?): string;
      hasKey(namespace, key): boolean;
  }
  ```

  Two implementations — the reactive store and a server catalog tree — one
  translator implementation. `createTranslator` already depended only on
  `Pick<I18nStore, 'translateKey'>`, so it was structurally portable; it just
  lived in a module that imports the store at value level.

  Breaking, with no aliases or deprecation shims — this surface is unreleased:
  - **`ServerScope` removed.** The third argument to `t()` is now
    `ServerTranslateOptions` — the same `{ locale?, namespace? }` plus the
    call-site `default` the client already had.
  - **`RequestTranslator` removed.** `createRequestT()(request)` returns the same
    `LocaleTranslator` as `createServerT().forLocale(locale)`; a request only
    decides *which* locale, so there was nothing else to model. `createRequestT`
    collapsed to a single expression as a result.
  - **`forLocale(locale, scope?)` → `forLocale(locale)`**, returning a
    `LocaleTranslator` rather than a bare `(key, params) => string`. Namespace
    binding moved to `.forNamespace(ns)` on the result.
  - **`forNamespace(ns)` returns the typed proxy**, not a bare function. It is
    still callable as `m('key', params)`, but `m.key()`, `m.key({ … })` and
    `` `${m.key}` `` now work too, and the key is validated.
  - New on both: **`.dynamic(ns)`** (the server's `useDynamicTranslation` — open
    keys, call-site `default`, `exists`) and **`.exists(key, options?)`**.
- **`TranslateOptions` moved** from the store's exports to `types.js`; still
  re-exported from `@sigx/i18n`, so only a deep import would notice.

### Added
- **`translateWith()`** (`@sigx/i18n`) — `translate` plus the per-call
  `options.default`, formatted through the configured formatter like any catalog
  string. The single place that knows how a call-site fallback behaves, so the
  store and the server translator cannot drift.
- **Three gates that make "the server entry is sigx-free" structural** rather
  than an accident of the import graph — it became load-bearing once the server
  started sharing the client's translator:
  - `edge-clean.test.ts` walks the transitive source graph from `server.ts` and
    fails if any module in it imports `@sigx/store`, `@sigx/reactivity`,
    `@sigx/runtime-core`, or `sigx`. Two guard-the-guard cases keep it from going
    vacuous, including one asserting the walk *does* find the store from
    `accessor.ts`.
  - A `.size-limit.json` budget on `dist/server.js` with **no** sigx `ignore`
    list, so a sigx import blows the budget (currently 2.12 kB of 3 kB).
  - `verify-pack` now imports `@sigx/i18n/server` from the packed tarball and
    exercises the typed proxy, coercion, and a dynamic `default`.

### Fixed
- **`checkCatalogs`/`buildManifest` no longer skip a namespace absent from the
  master locale** (#33). Both were driven by master entries, so `sv/legal.json`
  with no `en/legal.json` passed the gate silently — while still landing in
  `manifest.namespaces`, which made it a `KnownNamespace` whose
  `KeysForNamespace` was `never` (every key on it a compile error, with no
  diagnostic pointing at the missing master file). The check now takes its
  namespace universe from *all* entries and reports the gap as a new
  `missing-master` problem kind (an error under `strict: 'error'`, a warning
  under `'warn'`, suppressed by `ignoreLocales`), and `buildManifest` derives
  `namespaces` from the master-derived `messages` so the two cannot disagree.

### Added
- **Runtime-sourced catalogs** (#31) — support for the class of app whose
  user-facing content is authored outside the codebase (a CMS, a form builder,
  an admin-editable notification template), where the strings *and their keys*
  live in a database and change without a deploy. Four pieces, each usable alone:
  - **`runtimeNamespaces`** (`@sigx/i18n/vite`, and `--runtime-namespaces` on the
    CLI) — declares a namespace as having no build-time catalog. It is exempt
    from the completeness gate and typed with open `string` keys, while the
    static namespaces around it keep the full gate and the literal key union. It
    lands in the generated `Schema` as its own `runtimeNamespaces` union, so
    "typed namespace, open keys" is now deliberate rather than the accidental
    `never` shape fixed above.
  - **`useDynamicTranslation(ns)`** — the sanctioned untyped lookup, replacing
    reaching into `store.translateKey`. Returns a plain callable with a
    per-call `{ default }` (the author's original text, so a missing translation
    never renders a raw `block.a1b2c3.label`) and an `exists(key)` probe that
    fires neither `onMissing` nor a dev warning. Deliberately *not* a member of
    the `t` proxy: every property of `t` is a message key, so a reserved
    `t.exists` would be a hole in the key space — and, post-codegen, a type lie.
    `<T>` gains a matching `default` prop.
  - **`store.invalidate(locale?, ns?)`** — drop cached catalogs and refetch the
    active ones, so a client picks up a publish without a page reload.
    Stale-while-revalidate (the old catalog renders until the refetch lands), and
    a per-pair generation guard means a superseded in-flight request can no
    longer land its stale result and undo the invalidation.
  - **Surfaced load failures** — `config.onLoadError`, plus reactive
    `error` / `retry()` on `useLocale()` (`store.loadError` / `store.retry`).
    Previously `loadOne` swallowed the rejection, so a network-backed loader
    could not drive a "translations unavailable / retry" affordance.
- **`lookup()`** (`@sigx/i18n`) — the locale-chain resolution step split out of
  `translate`, returning the raw message and the locale it was *found* in.
  Powers `store.hasKey` / `exists` without formatting or missing-key handling.
- **`provideI18nConfig(options)`** — makes the config reachable with **no app**.
  Under `@sigx/resume` there is no client app: an upgraded boundary is hydrated
  directly, so nothing installed `createI18n`, and a boundary translating against
  state that changes client-side threw the moment it upgraded. Call this from a
  module the boundary's chunk imports; that chunk loads only on upgrade, so a
  zero-JS page stays zero-JS. Client-only — a process-wide config would be shared
  by every SSR request, and `detection.context` carries request headers. Resolution
  order is DI first, seam second.
- **`examples/resume-i18n`** — the reference app, mirroring core's
  `examples/resume`: a zero-JS server-round-trip locale switch, translated copy
  that never hydrates, a translated QRL boundary that upgrades and re-translates
  in the browser, and a server function answering in the caller's language over a
  `serverOnly` catalog. `pnpm --filter @sigx/i18n-resume-example smoke` runs 15
  assertions against the production build — including that the page references
  exactly one script and that no `node:` specifier reaches the server bundle.
  Its `greet` server function declares `unguarded: true`: core 0.14 requires every
  server function to derive from a preset, declare `use`, or say so explicitly
  (rfc-server-v3 §1.3-1.4).

## [0.2.0] - 2026-07-29

### Changed / removed
- **Aligned against sigx core `0.14.0`** — the catalog pins move `^0.13.0` →
  `^0.14.0`, and `@sigx/store` to `>=0.12.0 <0.13.0` (dev `^0.12.0`). No source
  changes were needed. Verified beyond the unit suite (128 tests) by driving
  `examples/showcase-ssr` in a browser against core 0.14: both locales render
  correctly on the server — including ICU plurals, locale number and date
  formatting, and fallback to English for an English-only key — the `store:i18n`
  entry still reaches `window.__SIGX_ASYNC__`, hydration is clean with no
  mismatch warnings, and the in-page language switcher re-renders reactively
  without a navigation. That last check matters on this release: core 0.14 makes
  a reactive object's key set a dependency (signalxjs/core#521), and a message
  catalogue is exactly the kind of enumerated reactive object that change
  affects.
- **Aligned against sigx core `0.13.0`** — the catalog pins (`@sigx/reactivity`,
  `@sigx/runtime-core`, `@sigx/runtime-dom`, `@sigx/server-renderer`,
  `@sigx/vite`, `sigx`) move `^0.12.0` → `^0.13.0`. No source changes were
  needed.
- **`@sigx/store` pinned to `>=0.11.0 <0.12.0`** (dev `^0.11.0`), up from the
  `0.9.x` line. Two published store minors land with it: 0.10.0 retargets core
  0.13, and **0.11.0 makes `ssrState()` non-consuming** (signalxjs/store#70).
  That last one is a behaviour change i18n has wanted: the SSR transfer entry
  now survives seeding, so **every** i18n store instance in a document gets the
  server's locale and catalogs, each with its own structural copy. Under
  `@sigx/ssr-islands` every island root is its own component tree, and under
  `@sigx/resume` each separately-upgraded boundary can be — with the old
  consume-once default, island #2 onward rendered the *wrong language* and
  refetched catalogs the server had already serialized into the blob it had
  just discarded. No i18n code was required to get this; the pin is the fix, and
  the local repair once planned for it is no longer needed (#15).
- **`createServerT` no longer reads the filesystem** and is now synchronous. It
  takes `{ catalogs }` instead of `{ localesDir }`; pair it with `loadCatalogs()`
  from `@sigx/i18n/server/node` for the old behaviour.
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
- **The server translator is now universal.** `@sigx/i18n/server` takes catalogs
  as data (`createServerT({ catalogs, … })`) and has **no `node:` imports**, so it
  runs unchanged on workerd, Deno, Bun and inside the bundled server builds the
  `@sigx/cloudflare` / `@sigx/vercel` / `@sigx/netlify` adapters produce — where a
  `node:` specifier fails the build. A new `edge-clean` test pins the invariant.
- **`@sigx/i18n/server/node`** — the filesystem half, split off: `loadCatalogs(dir)`
  reads `<localesDir>/<locale>/<namespace>.json` into a `MessageTree`. It re-exports
  `createServerT`/`createRequestT`, so a Node caller still needs one import line.
- **`createRequestT(options)`** — build once, bind per request. Returns
  `(request) => { locale, t, forNamespace }`, negotiating from the request's
  `Accept-Language` / cookie / query. Accepts a WinterCG `Request` or a Node
  `{ url, headers }`. `@sigx/server` is deliberately not imported in either
  direction — the caller passes `rq.request`.
- **Virtual catalog modules** (`@sigx/i18n/vite`): `virtual:sigx-i18n/catalogs` and
  `virtual:sigx-i18n/server-catalogs` inline the catalog tree as code, so an edge
  build with no filesystem still has its translations. The new `serverOnly`
  option (namespace globs — `'mail'`, `'jobs/*'`, `'internal/**'`) decides the
  split; those namespaces never enter the client tree. Both modules are
  invalidated by the existing catalog watcher in dev. Types ship as
  `@sigx/i18n/virtual`.
- **Request/locale-switch helpers** (`@sigx/i18n`): `detectionContextFromRequest`,
  `resolveRequestLocale`, `localeCookie`, `localeSwitchUrl`, `LOCALE_COOKIE` — the
  primitives behind server-side detection and the zero-JS, server-round-trip
  locale switch. Pure and structurally typed, so they compile without DOM lib.
- **`persistence.transferMessages` option** (default `true`). Set `false` on a
  **resumable** page: it ships no component JS on load, so the catalogs in the
  SSR transfer blob are bytes nothing reads — the server already rendered every
  string into the HTML. The locale still transfers, so a boundary that later
  upgrades knows its language and lazy-loads only the namespaces it actually
  needs. Reached through `createI18n({ persistence: { transferMessages: false } })`.
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
- Peer dependencies target the **0.13** SignalX runtime: `@sigx/reactivity`,
  `@sigx/runtime-core`, `@sigx/vite`, and `sigx` at `>=0.13.0 <0.14.0`;
  `@sigx/store` at `>=0.11.0 <0.12.0`.
