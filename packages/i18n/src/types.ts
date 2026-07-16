/**
 * Shared runtime types for @sigx/i18n.
 *
 * The typed key/param surface (the `t.a.b(...)` accessor autocomplete and the
 * "unknown key is a compile error" guarantee) is layered on top of these by the
 * generated `.d.ts` from `@sigx/i18n/vite` — see the `Schema` augmentation seam
 * at the bottom. Without the plugin these types stay permissive (plain strings),
 * so the runtime works with or without codegen.
 */

/** CLDR plural categories, as returned by `Intl.PluralRules#select`. */
export type PluralCategory = Intl.LDMLPluralRule; // 'zero'|'one'|'two'|'few'|'many'|'other'

/**
 * A plural/variant message: an object keyed by CLDR plural category (or the
 * catch-all `other`). Selected by the `count` param via `Intl.PluralRules`.
 * `#` inside a form is replaced by the locale-formatted count.
 */
export type PluralForms = { other: string } & Partial<Record<PluralCategory, string>>;

/** A single resolvable message: a plain string or a plural/variant object. */
export type MessageValue = string | PluralForms;

/**
 * A loaded catalog for one `(target, locale, namespace)`. Values may be nested
 * (`{ cart: { title } }` → key `"cart.title"`) or flat dotted (`{ "cart.title" }`).
 * A `PluralForms` object is a leaf, not a nested group (detected heuristically:
 * an object whose keys are all plural categories).
 */
export interface Catalog {
    [key: string]: MessageValue | Catalog;
}

/** Interpolation params passed to `t(key, params)`. `count` drives plural selection. */
export type Params = Record<string, unknown> & { count?: number };

/** `messages[target][locale][namespace] -> Catalog`. */
export type MessageTree = Record<string, Record<string, Record<string, Catalog>>>;

/** Context handed to a formatter for one resolution. */
export interface FormatContext {
    /** The locale the message was *found* in (may differ from the requested one). */
    locale: string;
    /** The dotted key being formatted (for diagnostics). */
    key: string;
}

/**
 * Pluggable message formatter. The default (`lightweightFormatter`) handles
 * `{var}` interpolation, `{arg, number|date|time}` tokens, and plural selection.
 * Swap in a full ICU implementation via `createI18n({ formatter })`.
 */
export interface Formatter {
    format(message: MessageValue, params: Params | undefined, ctx: FormatContext): string;
}

/** Info passed to the missing-key handler. */
export interface MissingInfo {
    key: string;
    namespace: string;
    /** The originally requested locale (not the fallback chain). */
    locale: string;
    /** The originally requested target. */
    target: string;
}

/** Target (scope) definition — names are entirely consumer-defined. */
export interface TargetDef {
    /** Inherit from another target when a key is absent here. */
    extends?: string;
}

/** The resolution scope for a single `translate` call. */
export interface ResolveScope {
    target: string;
    locale: string;
    namespace: string;
}

/**
 * Config shared by the pure `translate` core, the reactive store, and the
 * server translator.
 */
export interface TranslateConfig {
    /** The master locale — source of truth for which keys exist. */
    fallbackLocale: string;
    /** Optional explicit locale fallbacks (e.g. `{ nb: 'no' }`), applied on top of BCP-47 truncation. */
    localeFallbacks?: Record<string, string>;
    /** Target graph; when omitted, a single default target is used. */
    targets?: Record<string, TargetDef>;
    /** Message formatter. Defaults to `lightweightFormatter`. */
    formatter: Formatter;
    /** Called when no locale/target in the chains has the key. Default: dev-warn + return the key. */
    onMissing?: (info: MissingInfo) => string;
}

/**
 * Augmentation seam for the Vite plugin's generated types. The plugin emits
 * `declare module '@sigx/i18n' { interface Schema { … } }` describing the real
 * targets/locales/namespaces/keys/params; the accessor and `useTranslation`
 * read from `Schema` when present and fall back to permissive strings otherwise.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Schema {}
