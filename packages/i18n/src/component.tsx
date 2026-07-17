/**
 * The universal `<T>` translation component — renderer-agnostic (DOM, lynx,
 * terminal, SSR). It renders the translated text as a child node and touches no
 * DOM API, so it works on any sigx renderer unchanged. On lynx (where bare
 * strings paint only inside a `<text>` host) place it inside a `<text>`:
 * `<text><T k="cart.title" /></text>`.
 *
 * Lives in the core `@sigx/i18n` entry (peers only on `@sigx/runtime-core`) so
 * there is ONE implementation across renderers — no `/dom` vs `/lynx` fork.
 */

import { component, type Define } from 'sigx';
import type { JSXElement } from '@sigx/runtime-core';
import { useI18n } from './store.js';
import type { Params } from './types.js';

/** A rich-tag renderer: wraps inner text in a (renderer-appropriate) node. */
export type RichComponents = Record<string, (children: string) => JSXElement>;

const RICH_TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

/**
 * Split an already-interpolated string on `<name>inner</name>` tags, mapping
 * each tag to `components[name](inner)`. Non-nested; unknown tags stay literal.
 * Consumers supply renderer-appropriate nodes (a DOM `<a>` or a lynx element) —
 * the library only positions them, so this stays renderer-agnostic.
 */
export function renderRich(text: string, components: RichComponents): (string | JSXElement)[] {
    const out: (string | JSXElement)[] = [];
    let last = 0;
    for (const match of text.matchAll(RICH_TAG)) {
        const [full, name, inner] = match;
        const start = match.index ?? 0;
        if (start > last) out.push(text.slice(last, start));
        const render = components[name];
        out.push(render ? render(inner) : full);
        last = start + full.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

export type TProps = Define.Prop<'k', string, true> &
    Define.Prop<'params', Params, false> &
    Define.Prop<'ns', string, false> &
    Define.Prop<'components', RichComponents, false>;

/**
 * Declarative translation.
 *
 * ```tsx
 * <T k="cart.items" params={{ count }} />
 * <T k="legal.terms" components={{ a: (c) => <a href="/terms">{c}</a> }} />
 * // lynx: <text><T k="cart.title" /></text>
 * ```
 */
export const T = component<TProps>(({ props }) => {
    const store = useI18n();
    const ns = () => props.ns ?? store.defaultNamespace;
    void store.ensureNamespace(ns()); // loads the namespace on first use

    return () => {
        const text = store.translateKey(ns(), props.k, props.params);
        if (props.components) {
            return <>{renderRich(text, props.components)}</>;
        }
        return <>{text}</>;
    };
});
