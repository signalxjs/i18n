/**
 * The default lightweight, pluggable message formatter.
 *
 * Handles, with zero parser weight:
 *  - `{name}` interpolation,
 *  - `{arg, number}` / `{arg, date}` / `{arg, time}` via cached `Intl` formatters,
 *  - plural selection over `PluralForms` objects via `Intl.PluralRules` (`count`),
 *  - `#` inside a plural form → the locale-formatted `count`.
 *
 * `Intl` is treated as optional. On an engine that lacks it (Lynx's PrimJS, for
 * one) every branch degrades instead of throwing: plurals pick `one`/`other`,
 * numbers render as `String(n)`, dates and times go through `toLocale*String`.
 * Output loses locale nuance, but rendering never fails.
 *
 * A full ICU implementation can replace this wholesale via
 * `createI18n({ formatter })` — the runtime only depends on the `Formatter`
 * interface, never on this file.
 */

import type { Formatter, FormatContext, MessageValue, Params, PluralCategory, PluralForms } from './types.js';

const PLURAL_CATEGORIES = new Set<string>(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * Heuristic: an object is a `PluralForms` leaf (not a nested catalog group) when
 * it has at least one key and every key is a CLDR plural category. This is the
 * same convention several i18n libraries use; collisions (a real group whose
 * keys are all named after plural categories) are vanishingly rare.
 */
export function isPluralForms(value: unknown): value is PluralForms {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (keys.length === 0) return false;
    return keys.every(k => PLURAL_CATEGORIES.has(k));
}

// ── Intl availability ───────────────────────────────────────────────────────
// Some engines ship no `Intl` at all — Lynx's PrimJS (QuickJS-derived) is one,
// and there `Intl` is an undefined *global*, so touching it throws a
// ReferenceError rather than yielding undefined. Detect per constructor and per
// call: a polyfill loaded after this module was evaluated still gets picked up,
// and fallbacks are never cached, so nothing pins the degraded behaviour.
const warnedMissing = new Set<string>();

function intlHas(name: 'NumberFormat' | 'DateTimeFormat' | 'PluralRules'): boolean {
    const ok = typeof Intl !== 'undefined'
        && typeof (Intl as unknown as Record<string, unknown>)[name] === 'function';
    if (__DEV__ && !ok && !warnedMissing.has(name)) {
        warnedMissing.add(name);
        console.warn(
            `[@sigx/i18n] Intl.${name} is unavailable on this engine — degrading to a plain fallback. ` +
            `Load an Intl polyfill or pass createI18n({ formatter }) for full ICU output.`
        );
    }
    return ok;
}

/** The subset of an `Intl` formatter this module actually uses. */
interface FormatterLike<T> { format(value: T): string }

// `toLocale*String` is ES5 core (present even on PrimJS) and its locale argument
// is spec'd as ignorable, so passing it is safe and honoured where ICU exists.
const plainNumber: FormatterLike<number> = { format: n => String(n) };
const plainDate = (locale: string): FormatterLike<Date> => ({ format: d => d.toLocaleDateString(locale) });
const plainTime = (locale: string): FormatterLike<Date> => ({ format: d => d.toLocaleTimeString(locale) });

// ── Intl formatter caches (per locale / per locale+kind) ────────────────────
const numberFmts = new Map<string, Intl.NumberFormat>();
const dateFmts = new Map<string, Intl.DateTimeFormat>();
const timeFmts = new Map<string, Intl.DateTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

function numberFmt(locale: string): FormatterLike<number> {
    if (!intlHas('NumberFormat')) return plainNumber;
    let f = numberFmts.get(locale);
    if (!f) { f = new Intl.NumberFormat(locale); numberFmts.set(locale, f); }
    return f;
}
function dateFmt(locale: string): FormatterLike<Date> {
    if (!intlHas('DateTimeFormat')) return plainDate(locale);
    let f = dateFmts.get(locale);
    if (!f) { f = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }); dateFmts.set(locale, f); }
    return f;
}
function timeFmt(locale: string): FormatterLike<Date> {
    if (!intlHas('DateTimeFormat')) return plainTime(locale);
    let f = timeFmts.get(locale);
    if (!f) { f = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }); timeFmts.set(locale, f); }
    return f;
}
function plural(locale: string, n: number): PluralCategory {
    // Without CLDR rules the best available answer is the English shape; the
    // caller already falls back to `other` when the chosen form is absent.
    if (!intlHas('PluralRules')) return n === 1 ? 'one' : 'other';
    let r = pluralRules.get(locale);
    if (!r) { r = new Intl.PluralRules(locale); pluralRules.set(locale, r); }
    return r.select(n) as PluralCategory;
}

// `{ argName }` or `{ argName , number|date|time }`
const TOKEN = /\{\s*(\w+)\s*(?:,\s*(number|date|time)\s*)?\}/g;

function interpolate(template: string, params: Params | undefined, ctx: FormatContext): string {
    if (template.indexOf('{') === -1) return template;
    return template.replace(TOKEN, (match, name: string, kind: string | undefined) => {
        const value = params?.[name];
        if (value === undefined || value === null) {
            if (__DEV__) {
                console.warn(`[@sigx/i18n] missing param "${name}" for key "${ctx.key}" (${ctx.locale}).`);
            }
            return match; // keep the placeholder visible rather than blanking it
        }
        switch (kind) {
            case 'number':
                return numberFmt(ctx.locale).format(Number(value));
            case 'date':
                return dateFmt(ctx.locale).format(toDate(value));
            case 'time':
                return timeFmt(ctx.locale).format(toDate(value));
            default:
                return String(value);
        }
    });
}

function toDate(value: unknown): Date {
    return value instanceof Date ? value : new Date(value as number | string);
}

function formatPlural(forms: PluralForms, params: Params | undefined, ctx: FormatContext): string {
    const count = typeof params?.count === 'number' ? params.count : 0;
    if (__DEV__ && typeof params?.count !== 'number') {
        console.warn(`[@sigx/i18n] plural key "${ctx.key}" (${ctx.locale}) needs a numeric "count" param.`);
    }
    const category = plural(ctx.locale, count);
    const chosen = forms[category] ?? forms.other;
    // `#` → locale-formatted count (ICU convention), then normal interpolation.
    const withCount = chosen.replace(/#/g, numberFmt(ctx.locale).format(count));
    return interpolate(withCount, params, ctx);
}

/** The default formatter. Stateless aside from the module-level Intl caches. */
export const lightweightFormatter: Formatter = {
    format(message: MessageValue, params: Params | undefined, ctx: FormatContext): string {
        if (typeof message === 'string') {
            return interpolate(message, params, ctx);
        }
        return formatPlural(message, params, ctx);
    }
};
