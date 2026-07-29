// The ONLY script this page ships: the generated resume loader — delegation
// listeners plus lazy references to the QRL registry and the resume runtime,
// both of which load on first interaction and never before.
//
// Note what is NOT here: no app, no `createI18n`, no catalogs. The document is
// already translated. A boundary that needs a translator in the browser gets its
// config from `provideI18nConfig()` in src/i18n.ts, via its own chunk.
import 'virtual:sigx-resume/entry';
