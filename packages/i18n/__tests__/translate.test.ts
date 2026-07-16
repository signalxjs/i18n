/** Tests for @sigx/i18n pure translation core (fallback + targets). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { translate, getMessage, localeChain, targetChain } from '../src/translate.js';
import { lightweightFormatter } from '../src/formatter.js';
import type { MessageTree, TranslateConfig } from '../src/types.js';

const cfg = (over: Partial<TranslateConfig> = {}): TranslateConfig => ({
    fallbackLocale: 'en',
    formatter: lightweightFormatter,
    ...over
});

afterEach(() => vi.restoreAllMocks());

describe('getMessage', () => {
    it('reads flat dotted keys', () => {
        expect(getMessage({ 'cart.title': 'Cart' }, 'cart.title')).toBe('Cart');
    });
    it('walks nested groups', () => {
        expect(getMessage({ cart: { title: 'Cart' } }, 'cart.title')).toBe('Cart');
    });
    it('returns a plural leaf', () => {
        expect(getMessage({ items: { one: '# item', other: '# items' } }, 'items')).toEqual({
            one: '# item',
            other: '# items'
        });
    });
    it('returns undefined for a missing key or a non-leaf group', () => {
        expect(getMessage({ cart: { title: 'Cart' } }, 'cart.missing')).toBeUndefined();
        expect(getMessage({ cart: { title: 'Cart' } }, 'cart')).toBeUndefined();
    });
});

describe('localeChain', () => {
    it('truncates BCP-47 then appends the master', () => {
        expect(localeChain('sv-FI', 'en')).toEqual(['sv-FI', 'sv', 'en']);
    });
    it('applies explicit mappings', () => {
        expect(localeChain('nb', 'en', { nb: 'no' })).toEqual(['nb', 'no', 'en']);
    });
    it('dedupes when locale equals the master', () => {
        expect(localeChain('en', 'en')).toEqual(['en']);
    });
});

describe('targetChain', () => {
    it('follows extends ancestry', () => {
        expect(targetChain('admin', { admin: { extends: 'common' }, common: {} })).toEqual([
            'admin',
            'common'
        ]);
    });
    it('is cycle-safe', () => {
        expect(targetChain('a', { a: { extends: 'b' }, b: { extends: 'a' } })).toEqual(['a', 'b']);
    });
    it('handles the default (empty) target', () => {
        expect(targetChain('')).toEqual(['']);
    });
});

describe('translate — master fallback', () => {
    const tree: MessageTree = {
        '': {
            en: { common: { hi: 'Hi', only_en: 'English only' } },
            sv: { common: { hi: 'Hej' } }
        }
    };
    const scope = (locale: string) => ({ target: '', locale, namespace: 'common' });

    it('uses the requested locale when present', () => {
        expect(translate(tree, 'hi', undefined, scope('sv'), cfg())).toBe('Hej');
    });

    it('falls back to the master locale for untranslated keys', () => {
        expect(translate(tree, 'only_en', undefined, scope('sv'), cfg())).toBe('English only');
    });

    it('walks the BCP-47 chain (sv-FI → sv → en)', () => {
        expect(translate(tree, 'hi', undefined, scope('sv-FI'), cfg())).toBe('Hej');
        expect(translate(tree, 'only_en', undefined, scope('sv-FI'), cfg())).toBe('English only');
    });

    it('returns the key and warns when nothing resolves', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(translate(tree, 'nope', undefined, scope('sv'), cfg())).toBe('nope');
        expect(warn).toHaveBeenCalledOnce();
    });

    it('honours a custom onMissing handler', () => {
        const onMissing = vi.fn(() => '∅');
        expect(translate(tree, 'nope', undefined, scope('sv'), cfg({ onMissing }))).toBe('∅');
        expect(onMissing).toHaveBeenCalledWith({
            key: 'nope',
            namespace: 'common',
            locale: 'sv',
            target: ''
        });
    });
});

describe('translate — targets', () => {
    const tree: MessageTree = {
        common: { en: { nav: { home: 'Home' } }, sv: { nav: { home: 'Hem' } } },
        admin: { en: { nav: { dash: 'Dashboard' } } }
    };
    const config = cfg({ targets: { admin: { extends: 'common' }, common: {} } });

    it('resolves a key defined only in the extends base', () => {
        // admin has no `home`; inherits it from common
        expect(translate(tree, 'home', undefined, { target: 'admin', locale: 'sv', namespace: 'nav' }, config)).toBe(
            'Hem'
        );
    });

    it('prefers the active target over the base', () => {
        expect(
            translate(tree, 'dash', undefined, { target: 'admin', locale: 'en', namespace: 'nav' }, config)
        ).toBe('Dashboard');
    });

    it('does not leak base-only keys the other direction', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // common cannot see admin's `dash`
        expect(
            translate(tree, 'dash', undefined, { target: 'common', locale: 'en', namespace: 'nav' }, config)
        ).toBe('dash');
        warn.mockRestore();
    });
});

describe('translate — plural via store path', () => {
    const tree: MessageTree = {
        '': { en: { cart: { items: { one: '# item', other: '# items' } } } }
    };
    it('formats plurals found through fallback in the found locale', () => {
        expect(
            translate(tree, 'items', { count: 3 }, { target: '', locale: 'de', namespace: 'cart' }, cfg())
        ).toBe('3 items');
    });
});
