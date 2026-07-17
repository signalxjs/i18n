/** Tests for @sigx/i18n pure translation core (master fallback). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { translate, getMessage, localeChain } from '../src/translate.js';
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

describe('translate — master fallback', () => {
    const tree: MessageTree = {
        en: { common: { hi: 'Hi', only_en: 'English only' } },
        sv: { common: { hi: 'Hej' } }
    };
    const scope = (locale: string) => ({ locale, namespace: 'common' });

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
        expect(onMissing).toHaveBeenCalledWith({ key: 'nope', namespace: 'common', locale: 'sv' });
    });
});

describe('translate — hierarchical namespaces', () => {
    const tree: MessageTree = {
        en: { 'admin/users': { title: 'Users' } }
    };
    it('resolves a key under a nested namespace path', () => {
        expect(translate(tree, 'title', undefined, { locale: 'en', namespace: 'admin/users' }, cfg())).toBe('Users');
    });
});

describe('translate — plurals', () => {
    const tree: MessageTree = {
        en: { cart: { items: { one: '# item', other: '# items' } } }
    };
    it('formats plurals found through fallback in the found locale', () => {
        expect(translate(tree, 'items', { count: 3 }, { locale: 'de', namespace: 'cart' }, cfg())).toBe('3 items');
    });
});
