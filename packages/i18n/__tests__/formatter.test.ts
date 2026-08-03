/** Tests for @sigx/i18n lightweight formatter. */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { lightweightFormatter as f, isPluralForms } from '../src/formatter.js';
import type { FormatContext, Formatter } from '../src/types.js';

const ctx = (locale = 'en'): FormatContext => ({ locale, key: 'test.key' });

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

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

// Engines like Lynx's PrimJS (QuickJS-derived) ship no `Intl` global at all, so
// every plural lookup used to throw a ReferenceError from inside a render (#54).
describe('engines without Intl', () => {
    /**
     * A fresh module instance per test: the formatter's Intl caches are
     * module-level, so reusing the imported one would hand back formatters
     * built while Intl still existed — exactly what a real device never has.
     */
    async function bootWithout(intl: unknown): Promise<Formatter> {
        vi.resetModules();
        vi.stubGlobal('Intl', intl);
        return (await import('../src/formatter.js')).lightweightFormatter;
    }

    // Silence the dev warning; the test that asserts on it spies again on top.
    beforeEach(() => void vi.spyOn(console, 'warn').mockImplementation(() => {}));

    const scenarios: Array<[string, unknown]> = [
        ['no Intl global at all', undefined],
        ['an Intl object without the constructors', {}]
    ];

    for (const [name, stub] of scenarios) {
        describe(name, () => {
            it('formats a plural key instead of throwing', async () => {
                // The reported repro: a `#`-only catalog entry, once per list row.
                const f2 = await bootWithout(stub);
                expect(f2.format({ one: '#m ago', other: '#m ago' }, { count: 3 }, ctx())).toBe('3m ago');
            });

            it('falls back to a one/other plural split', async () => {
                const f2 = await bootWithout(stub);
                const items = { one: '# item', other: '# items' };
                expect(f2.format(items, { count: 1 }, ctx())).toBe('1 item');
                expect(f2.format(items, { count: 0 }, ctx())).toBe('0 items');
                expect(f2.format(items, { count: 5 }, ctx())).toBe('5 items');
            });

            it('falls back to other when the one form is absent', async () => {
                const f2 = await bootWithout(stub);
                expect(f2.format({ other: '# X' }, { count: 1 }, ctx())).toBe('1 X');
            });

            it('renders {arg, number} unformatted rather than throwing', async () => {
                const f2 = await bootWithout(stub);
                expect(f2.format('{n, number}', { n: 1234567 }, ctx())).toBe('1234567');
            });

            it('renders {arg, date} and {arg, time} via toLocale*String', async () => {
                const f2 = await bootWithout(stub);
                const d = new Date('2026-07-16T13:30:00Z');
                expect(f2.format('{d, date}', { d }, ctx())).toMatch(/\d/);
                expect(f2.format('{d, time}', { d }, ctx())).toMatch(/\d/);
            });

            it('leaves plain interpolation untouched', async () => {
                const f2 = await bootWithout(stub);
                expect(f2.format('Hello {name}!', { name: 'Sam' }, ctx())).toBe('Hello Sam!');
            });
        });
    }

    it('picks Intl back up when it becomes available (no cached fallbacks)', async () => {
        const f2 = await bootWithout(undefined);
        expect(f2.format({ other: '# things' }, { count: 1234 }, ctx('en'))).toBe('1234 things');
        vi.unstubAllGlobals();
        expect(f2.format({ other: '# things' }, { count: 1234 }, ctx('en'))).toBe('1,234 things');
    });

    it('warns once per missing constructor in dev', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const f2 = await bootWithout(undefined);

        f2.format({ other: '# items' }, { count: 2 }, ctx());
        f2.format({ other: '# items' }, { count: 3 }, ctx());

        expect(warn.mock.calls.map(c => String(c[0]))).toEqual([
            expect.stringContaining('Intl.PluralRules'),
            expect.stringContaining('Intl.NumberFormat')
        ]);
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
