/** Tests for layered catalogs — per-key composition and the global identity cache. */
import { describe, it, expect } from 'vitest';
import { composeCatalogs, composeAt, layerFor, flatten } from '../src/layers.js';
import { getMessage } from '../src/translate.js';
import type { Catalog, LayeredMessages } from '../src/index.js';

describe('composeCatalogs — per-key override', () => {
    it('overrides one key and leaves the rest of the base intact', () => {
        const base: Catalog = { title: 'Cart', empty: 'Nothing here', checkout: 'Checkout' };
        const tenant: Catalog = { title: 'Basket' };
        const merged = composeCatalogs([base, tenant]);

        expect(getMessage(merged, 'title')).toBe('Basket');
        expect(getMessage(merged, 'empty')).toBe('Nothing here');
        expect(getMessage(merged, 'checkout')).toBe('Checkout');
    });

    it('lets a later layer add keys the base never had', () => {
        const merged = composeCatalogs([{ a: 'A' }, { b: 'B' }]);
        expect(getMessage(merged, 'a')).toBe('A');
        expect(getMessage(merged, 'b')).toBe('B');
    });

    it('applies layers low→high, so the last one wins', () => {
        const merged = composeCatalogs([{ k: 'one' }, { k: 'two' }, { k: 'three' }]);
        expect(getMessage(merged, 'k')).toBe('three');
    });

    it('preserves plural forms as leaves, not as groups to merge into', () => {
        const base: Catalog = { items: { one: '# item', other: '# items' } };
        const tenant: Catalog = { items: { one: '# thing', other: '# things' } };
        expect(getMessage(composeCatalogs([base, tenant]), 'items')).toEqual({
            one: '# thing',
            other: '# things'
        });
    });

    // The hazard a hand-rolled deep merge gets wrong: `getMessage` accepts BOTH
    // spellings for the same key, so an override written the other way round
    // than the base must still shadow it. A DB-sourced override is very likely
    // to be stored flat while the shipped catalog is nested.
    it('makes flat-dotted and nested spellings interchangeable across layers', () => {
        const nestedBase: Catalog = { cart: { title: 'Cart', empty: 'Empty' } };
        const flatOverride: Catalog = { 'cart.title': 'Basket' };
        const a = composeCatalogs([nestedBase, flatOverride]);
        expect(getMessage(a, 'cart.title')).toBe('Basket');
        expect(getMessage(a, 'cart.empty')).toBe('Empty');

        // …and the reverse: nested override over a flat base.
        const flatBase: Catalog = { 'cart.title': 'Cart', 'cart.empty': 'Empty' };
        const nestedOverride: Catalog = { cart: { title: 'Basket' } };
        const b = composeCatalogs([flatBase, nestedOverride]);
        expect(getMessage(b, 'cart.title')).toBe('Basket');
        expect(getMessage(b, 'cart.empty')).toBe('Empty');
    });

    it('deep-merges nested groups instead of replacing them wholesale', () => {
        const base: Catalog = { cart: { title: 'Cart', empty: 'Empty', checkout: 'Go' } };
        const tenant: Catalog = { cart: { title: 'Basket' } };
        const merged = composeCatalogs([base, tenant]);
        expect(getMessage(merged, 'cart.title')).toBe('Basket');
        expect(getMessage(merged, 'cart.empty')).toBe('Empty'); // the bug #30 is about
        expect(getMessage(merged, 'cart.checkout')).toBe('Go');
    });
});

describe('composeCatalogs — the global identity cache', () => {
    it('returns the single catalog BY IDENTITY, so no-layers costs nothing', () => {
        const only: Catalog = { title: 'Cart' };
        expect(composeCatalogs([only])).toBe(only);
    });

    it('reuses the composition for the same catalogs in the same order', () => {
        const base: Catalog = { title: 'Cart' };
        const tenant: Catalog = { title: 'Basket' };
        // `toBe`, not `toEqual` — object identity is the only direct proof of a hit.
        expect(composeCatalogs([base, tenant])).toBe(composeCatalogs([base, tenant]));
    });

    it('is order-sensitive — [a,b] and [b,a] do not collide', () => {
        const a: Catalog = { k: 'A' };
        const b: Catalog = { k: 'B' };
        expect(getMessage(composeCatalogs([a, b]), 'k')).toBe('B');
        expect(getMessage(composeCatalogs([b, a]), 'k')).toBe('A');
        expect(composeCatalogs([a, b])).not.toBe(composeCatalogs([b, a]));
    });

    // The failure a global cache in a multi-tenant server would actually have:
    // two stacks sharing a prefix returning each other's answer.
    it('does not leak between stacks that share a prefix', () => {
        const base: Catalog = { title: 'Cart', shared: 'Shared' };
        const tenantA: Catalog = { title: 'Basket' };
        const tenantB: Catalog = { title: 'Trolley' };

        const a = composeCatalogs([base, tenantA]);
        const b = composeCatalogs([base, tenantB]);

        expect(getMessage(a, 'title')).toBe('Basket');
        expect(getMessage(b, 'title')).toBe('Trolley');
        expect(a).not.toBe(b);
        // Re-composing A after B must still be A's answer, not the most recent.
        expect(getMessage(composeCatalogs([base, tenantA]), 'title')).toBe('Basket');
    });

    it('distinguishes stacks of different length sharing a prefix', () => {
        const base: Catalog = { k: 'base' };
        const mid: Catalog = { k: 'mid' };
        const top: Catalog = { k: 'top' };
        expect(getMessage(composeCatalogs([base, mid]), 'k')).toBe('mid');
        expect(getMessage(composeCatalogs([base, mid, top]), 'k')).toBe('top');
        expect(getMessage(composeCatalogs([base, mid]), 'k')).toBe('mid');
    });

    // The cache's correctness rests on registered catalogs being immutable.
    it('never mutates an input catalog', () => {
        const base: Catalog = { title: 'Cart', empty: 'Empty' };
        const tenant: Catalog = { title: 'Basket' };
        const beforeBase = JSON.stringify(base);
        const beforeTenant = JSON.stringify(tenant);
        composeCatalogs([base, tenant]);
        expect(JSON.stringify(base)).toBe(beforeBase);
        expect(JSON.stringify(tenant)).toBe(beforeTenant);
    });

    it('composes an empty stack to an empty catalog', () => {
        expect(composeCatalogs([])).toEqual({});
    });
});

describe('composeAt', () => {
    const layered: LayeredMessages = {
        base: { en: { cart: { title: 'Cart', empty: 'Empty' } }, sv: { cart: { title: 'Kundvagn' } } },
        tenant: { en: { cart: { title: 'Basket' } } }
    };
    const order = ['base', 'tenant'];

    it('composes the layers present at one (locale, namespace)', () => {
        const en = composeAt(layered, order, 'en', 'cart');
        expect(getMessage(en as Catalog, 'title')).toBe('Basket');
        expect(getMessage(en as Catalog, 'empty')).toBe('Empty');
    });

    it('skips layers that have nothing at that pair', () => {
        // `tenant` has no sv → sv resolves from base alone, by identity.
        expect(composeAt(layered, order, 'sv', 'cart')).toBe(layered.base.sv.cart);
    });

    it('returns undefined when no layer has the pair', () => {
        expect(composeAt(layered, order, 'de', 'cart')).toBeUndefined();
        expect(composeAt(layered, order, 'en', 'nope')).toBeUndefined();
    });
});

describe('layerFor — provenance for explain()', () => {
    const layered: LayeredMessages = {
        base: { en: { cart: { title: 'Cart', empty: 'Empty' } } },
        tenant: { en: { cart: { title: 'Basket' } } }
    };
    const order = ['base', 'tenant'];

    it('reports the highest layer holding the key', () => {
        expect(layerFor(layered, order, 'en', 'cart', 'title')).toBe('tenant');
        expect(layerFor(layered, order, 'en', 'cart', 'empty')).toBe('base');
    });

    it('returns undefined for a key no layer has at that locale', () => {
        expect(layerFor(layered, order, 'en', 'cart', 'nope')).toBeUndefined();
        expect(layerFor(layered, order, 'sv', 'cart', 'title')).toBeUndefined();
    });

    it('sees a nested key through the flattening', () => {
        const nested: LayeredMessages = { base: { en: { cart: { a: { b: 'Deep' } } } } };
        expect(layerFor(nested, ['base'], 'en', 'cart', 'a.b')).toBe('base');
    });
});

describe('flatten still behaves as manifest.ts expects', () => {
    it('flattens nested and flat catalogs to dotted keys', () => {
        const flat = flatten({ cart: { title: 'Cart', items: { one: '# i', other: '# is' } }, 'a.b': 'x' });
        expect([...flat.keys()].sort()).toEqual(['a.b', 'cart.items', 'cart.title']);
    });
});

describe('composeCatalogs — hostile keys from a database override', () => {
    // Override catalogs routinely come from a DB, so `__proto__` is reachable by
    // untrusted input. On a plain `{}` target, `merged['__proto__'] = {…}` sets
    // the PROTOTYPE rather than an own key — and `getMessage` reads
    // `catalog[key]`, which walks the chain, so an override could inject values
    // for keys no layer legitimately supplies.
    // The payload has to be PLURAL-SHAPED to be dangerous, which is not obvious.
    // `flatten` recurses into a plain nested object, so `{"__proto__":{"title":…}}`
    // becomes the harmless dotted key `__proto__.title`. But `isPluralForms`
    // treats `{one,other,…}` as a LEAF, so that value is assigned straight to
    // `merged['__proto__']` — which on a plain `{}` sets the prototype, and
    // `getMessage` reads `catalog[key]`, walking the chain.
    it('cannot inject keys it does not own via a plural-shaped __proto__', () => {
        const base: Catalog = { greeting: 'Hello' };
        const hostile = JSON.parse('{"__proto__": {"other": "PWNED", "one": "PWNED"}}') as Catalog;
        const merged = composeCatalogs([base, hostile]);

        // `one`/`other` are supplied by NO layer as top-level keys.
        expect(getMessage(merged, 'other')).toBeUndefined();
        expect(getMessage(merged, 'one')).toBeUndefined();
        expect(getMessage(merged, 'greeting')).toBe('Hello');
    });

    it('does not leak into other objects or Object.prototype', () => {
        const hostile = JSON.parse('{"__proto__": {"other": "leaked"}}') as Catalog;
        composeCatalogs([{ a: 'A' }, hostile]);
        expect(({} as Record<string, unknown>).other).toBeUndefined();
        expect((Object.prototype as unknown as Record<string, unknown>).other).toBeUndefined();
    });

    it('keeps a nested __proto__ group as an ordinary dotted key', () => {
        // The non-plural case, for completeness: it flattens rather than assigning.
        const hostile = JSON.parse('{"__proto__": {"title": "PWNED"}}') as Catalog;
        const merged = composeCatalogs([{ a: 'A' }, hostile]);
        expect(getMessage(merged, 'title')).toBeUndefined();
        expect(getMessage(merged, '__proto__.title')).toBe('PWNED');
    });

    it('treats a message literally named __proto__ as an ordinary key', () => {
        // Built via JSON.parse on purpose: `{ __proto__: x }` as an object
        // LITERAL is JS's prototype-setter syntax and creates no own property,
        // so it could not reach the composer at all. A DB row or a parsed JSON
        // catalog — the actual source of overrides — does create one.
        const named = JSON.parse('{"__proto__": "a real message"}') as Catalog;
        const merged = composeCatalogs([{ a: 'A' }, named]);
        expect(getMessage(merged, '__proto__')).toBe('a real message');
        expect(getMessage(merged, 'a')).toBe('A');
    });

    it('is not confused by constructor / toString as message keys', () => {
        const merged = composeCatalogs([{ constructor: 'Ctor', toString: 'Str' }, { valueOf: 'Val' }]);
        expect(getMessage(merged, 'constructor')).toBe('Ctor');
        expect(getMessage(merged, 'toString')).toBe('Str');
        expect(getMessage(merged, 'valueOf')).toBe('Val');
    });
});
