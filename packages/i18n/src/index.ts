/**
 * @sigx/i18n — reactive localization for SignalX.
 *
 * Core entry: pure translation primitives, the default formatter, and (added in
 * later phases) the reactive store, `useTranslation` accessor, and `createI18n`
 * plugin. DOM bindings live in `@sigx/i18n/dom`, the server translator in
 * `@sigx/i18n/server`, and the build tooling in `@sigx/i18n/vite`.
 */

export type {
    Catalog,
    MessageValue,
    MessageTree,
    PluralForms,
    PluralCategory,
    Params,
    Formatter,
    FormatContext,
    MissingInfo,
    TargetDef,
    ResolveScope,
    TranslateConfig,
    Schema
} from './types.js';

export { lightweightFormatter, isPluralForms } from './formatter.js';
export { translate, getMessage, localeChain, targetChain, matchLocale } from './translate.js';

export { useI18n, useI18nConfig } from './store.js';
export type { I18nStore, I18nRuntimeConfig, LocaleLoader } from './store.js';

export {
    detectLocale,
    createDetectors,
    findSupported,
    parseAcceptLanguage,
    parseCookie,
    settingsDetector,
    browserDetector,
    cookieDetector,
    urlDetector
} from './detect.js';
export type { Detector, DetectionContext, DetectionOptions } from './detect.js';

export { installPersistSSR } from './persist-ssr.js';
export type { PersistSSROptions, PersistSSRHandle } from './persist-ssr.js';

export { useTranslation, useLocale, createTranslator } from './accessor.js';
export type { Translator, TranslatorNode, LocaleControls } from './accessor.js';

export { createI18n } from './plugin.js';
export type { I18nOptions } from './plugin.js';
