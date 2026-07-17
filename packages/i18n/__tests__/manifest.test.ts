/** Tests for the catalog manifest, completeness checker, and .d.ts generator. */
import { describe, it, expect } from 'vitest';
import {
    flatten,
    extractParams,
    buildManifest,
    checkCatalogs,
    generateDts,
    formatReport,
    type CatalogEntry
} from '../src/manifest.js';

describe('flatten + extractParams', () => {
    it('flattens nested and flat catalogs to dotted keys', () => {
        const flat = flatten({ cart: { title: 'Cart', items: { one: '# i', other: '# is' } }, 'a.b': 'x' });
        expect([...flat.keys()].sort()).toEqual(['a.b', 'cart.items', 'cart.title']);
    });
    it('extracts param names and types', () => {
        expect(extractParams('Hi {name}, you owe {amount, number} by {due, date}')).toEqual({
            name: 'string',
            amount: 'number',
            due: 'date'
        });
        expect(extractParams({ one: '# item', other: '# items' })).toEqual({ count: 'number' });
    });
});

const entries = (): CatalogEntry[] => [
    { locale: 'en', namespace: 'cart', catalog: { title: 'Cart', items: { one: '# item', other: '# items' }, hi: 'Hi {name}' } },
    { locale: 'sv', namespace: 'cart', catalog: { title: 'Kundvagn', items: { one: '# vara', other: '# varor' }, hi: 'Hej {name}' } }
];

describe('buildManifest', () => {
    it('derives locales/namespaces + master keys with params', () => {
        const m = buildManifest(entries(), 'en');
        expect(m.locales).toEqual(['en', 'sv']);
        expect(m.namespaces).toEqual(['cart']);
        expect(m.messages['cart']['hi']).toEqual({ name: 'string' });
        expect(m.messages['cart']['items']).toEqual({ count: 'number' });
    });
});

describe('checkCatalogs', () => {
    it('passes when a non-master locale is complete', () => {
        expect(checkCatalogs(entries(), { masterLocale: 'en' }).ok).toBe(true);
    });

    it('fails the build (error) when a key is missing in a locale', () => {
        const e = entries();
        (e[1].catalog as Record<string, unknown>).title = undefined;
        delete (e[1].catalog as Record<string, unknown>).title;
        const r = checkCatalogs(e, { masterLocale: 'en' });
        expect(r.ok).toBe(false);
        expect(r.errors.map(p => p.key)).toContain('title');
        expect(r.errors[0]).toMatchObject({ kind: 'missing', locale: 'sv', namespace: 'cart' });
    });

    it('flags a param mismatch as an error', () => {
        const e = entries();
        (e[1].catalog as Record<string, string>).hi = 'Hej {namn}'; // wrong param name
        const r = checkCatalogs(e, { masterLocale: 'en' });
        expect(r.ok).toBe(false);
        expect(r.errors.map(p => p.kind)).toContain('param-mismatch');
    });

    it('reports extraneous keys as warnings, not errors', () => {
        const e = entries();
        (e[1].catalog as Record<string, string>).extra = 'Extra';
        const r = checkCatalogs(e, { masterLocale: 'en' });
        expect(r.ok).toBe(true);
        expect(r.warnings.map(p => p.key)).toContain('extra');
    });

    it('honours ignoreMissing and ignoreLocales', () => {
        const e = entries();
        delete (e[1].catalog as Record<string, unknown>).title;
        expect(checkCatalogs(e, { masterLocale: 'en', ignoreMissing: ['title'] }).ok).toBe(true);
        expect(checkCatalogs(e, { masterLocale: 'en', ignoreMissing: ['cart:title'] }).ok).toBe(true);
        expect(checkCatalogs(e, { masterLocale: 'en', ignoreLocales: ['sv'] }).ok).toBe(true);
    });

    it('downgrades to warnings under strict:warn and skips under strict:off', () => {
        const e = entries();
        delete (e[1].catalog as Record<string, unknown>).title;
        const warn = checkCatalogs(e, { masterLocale: 'en', strict: 'warn' });
        expect(warn.ok).toBe(true);
        expect(warn.warnings.map(p => p.key)).toContain('title');
        expect(checkCatalogs(e, { masterLocale: 'en', strict: 'off' }).ok).toBe(true);
    });
});

describe('generateDts', () => {
    it('emits Schema augmentation with unions, keys, and params', () => {
        const dts = generateDts(buildManifest(entries(), 'en'));
        expect(dts).toContain("declare module '@sigx/i18n'");
        expect(dts).toContain('locales: "en" | "sv";');
        expect(dts).toContain('namespaces: "cart";');
        expect(dts).toContain('"hi": { "name": string | number };');
        expect(dts).toContain('"items": { "count": number };');
        expect(dts).toContain('"title": {};');
    });
});

describe('formatReport', () => {
    it('summarises errors and warnings', () => {
        const e = entries();
        delete (e[1].catalog as Record<string, unknown>).title;
        (e[1].catalog as Record<string, string>).extra = 'x';
        const report = formatReport(checkCatalogs(e, { masterLocale: 'en' }));
        expect(report).toContain('error(s)');
        expect(report).toContain('title');
        expect(report).toContain('warning(s)');
    });
});
