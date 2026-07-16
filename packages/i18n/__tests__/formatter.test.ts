/** Tests for @sigx/i18n lightweight formatter. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lightweightFormatter as f, isPluralForms } from '../src/formatter.js';
import type { FormatContext } from '../src/types.js';

const ctx = (locale = 'en'): FormatContext => ({ locale, key: 'test.key' });

afterEach(() => vi.restoreAllMocks());

describe('interpolation', () => {
    it('replaces named placeholders', () => {
        expect(f.format('Hello {name}!', { name: 'Sam' }, ctx())).toBe('Hello Sam!');
    });

    it('returns the string unchanged when it has no placeholders', () => {
        expect(f.format('Just text', undefined, ctx())).toBe('Just text');
    });

    it('keeps the placeholder and warns when a param is missing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(f.format('Hi {name}', {}, ctx())).toBe('Hi {name}');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('formats {arg, number} with the locale grouping', () => {
        expect(f.format('{n, number}', { n: 1234567 }, ctx('en'))).toBe('1,234,567');
        // sv-SE groups with non-breaking spaces
        expect(f.format('{n, number}', { n: 1234567 }, ctx('sv'))).toMatch(/1.234.567/);
    });

    it('formats {arg, date} and {arg, time}', () => {
        const d = new Date('2026-07-16T13:30:00Z');
        expect(f.format('{d, date}', { d }, ctx('en'))).toContain('2026');
        expect(f.format('{d, time}', { d }, ctx('en'))).toMatch(/\d/);
    });
});

describe('plurals', () => {
    const items = { one: '# item', other: '# items' };

    it('selects the "one" form for count 1 and "other" otherwise (en)', () => {
        expect(f.format(items, { count: 1 }, ctx('en'))).toBe('1 item');
        expect(f.format(items, { count: 0 }, ctx('en'))).toBe('0 items');
        expect(f.format(items, { count: 5 }, ctx('en'))).toBe('5 items');
    });

    it('replaces # with the locale-formatted count', () => {
        expect(f.format({ other: '# things' }, { count: 1234 }, ctx('en'))).toBe('1,234 things');
    });

    it('interpolates other params inside the chosen plural form', () => {
        const msg = { one: '{name} has # message', other: '{name} has # messages' };
        expect(f.format(msg, { count: 2, name: 'Sam' }, ctx('en'))).toBe('Sam has 2 messages');
    });

    it('uses richer categories for languages that need them (pl)', () => {
        const pl = { one: '# plik', few: '# pliki', many: '# plików', other: '# pliku' };
        expect(f.format(pl, { count: 1 }, ctx('pl'))).toBe('1 plik');
        expect(f.format(pl, { count: 3 }, ctx('pl'))).toBe('3 pliki');
        expect(f.format(pl, { count: 5 }, ctx('pl'))).toBe('5 plików');
    });

    it('falls back to other when the selected category form is absent', () => {
        expect(f.format({ other: '# X' }, { count: 1 }, ctx('en'))).toBe('1 X');
    });
});

describe('isPluralForms', () => {
    it('detects plural-category objects', () => {
        expect(isPluralForms({ one: 'a', other: 'b' })).toBe(true);
        expect(isPluralForms({ other: 'b' })).toBe(true);
    });
    it('rejects nested groups, strings, arrays, and empty objects', () => {
        expect(isPluralForms({ title: 'a', body: 'b' })).toBe(false);
        expect(isPluralForms('str')).toBe(false);
        expect(isPluralForms(['one', 'other'])).toBe(false);
        expect(isPluralForms({})).toBe(false);
        expect(isPluralForms(null)).toBe(false);
    });
});
