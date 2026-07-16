/**
 * @sigx/i18n/dom — DOM/TSX bindings.
 *
 *  - `<T>`  : the SSR-correct binding. Renders translated text (with params and
 *             optional rich `components`) as a child node, so the server emits
 *             the text and the client hydrates it without a flash.
 *  - `use:t`: a client-side convenience directive that sets an element's
 *             textContent from a key, reactively on locale change. It has no
 *             server hook (a directive can only merge attributes, not inner
 *             text), so for server-rendered text prefer `<T>`.
 *
 * Register the directive with `app.use(i18nDirectives())`; `<T>` needs no
 * registration.
 */

import { component, defineDirective, effect, type Define } from 'sigx';
import type { App, Plugin, JSXElement } from '@sigx/runtime-core';
import { useI18n, type I18nStore } from './store.js';
import type { Params } from './types.js';

// ── Rich interpolation ──────────────────────────────────────────────────────

/** A rich-tag renderer: wraps the inner text in an element. */
export type RichComponents = Record<string, (children: string) => JSXElement>;

const RICH_TAG = /<(\w+)>([\s\S]*?)<\/\1>/g;

/**
 * Split an already-interpolated string on `<name>inner</name>` tags, mapping
 * each tag to `components[name](inner)`. Non-nested; unknown tags stay literal.
 */
function renderRich(text: string, components: RichComponents): (string | JSXElement)[] {
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

// ── <T> component ───────────────────────────────────────────────────────────

export type TProps = Define.Prop<'k', string, true> &
    Define.Prop<'params', Params, false> &
    Define.Prop<'ns', string, false> &
    Define.Prop<'target', string, false> &
    Define.Prop<'components', RichComponents, false>;

/**
 * Declarative translation.
 *
 * ```tsx
 * <T k="cart.items" params={{ count }} />
 * <T k="legal.terms" components={{ a: (c) => <a href="/terms">{c}</a> }} />
 * ```
 */
export const T = component<TProps>(({ props }) => {
    const store = useI18n();
    const ns = () => props.ns ?? store.defaultNamespace;
    void store.ensureNamespace(ns());

    return () => {
        const text = store.translateKey(ns(), props.k, props.params, props.target);
        if (props.components) {
            return <>{renderRich(text, props.components)}</>;
        }
        return <>{text}</>;
    };
});

// ── use:t directive ─────────────────────────────────────────────────────────

/** `use:t` value: a bare key, or `[key, params?, { ns?, target? }?]`. */
export type TDirectiveValue =
    | string
    | [key: string, params?: Params, options?: { ns?: string; target?: string }];

interface TState {
    current: TDirectiveValue;
    paint: () => void;
    stop: () => void;
}

const T_STATE = Symbol('sigx.i18n.t');

function resolveText(store: I18nStore, value: TDirectiveValue): string {
    if (typeof value === 'string') {
        return store.translateKey(store.defaultNamespace, value);
    }
    const [key, params, options] = value;
    return store.translateKey(options?.ns ?? store.defaultNamespace, key, params, options?.target);
}

function nsOf(store: I18nStore, value: TDirectiveValue): string {
    return typeof value === 'string' ? store.defaultNamespace : value[2]?.ns ?? store.defaultNamespace;
}

/**
 * Build the `use:t` directive bound to an app's i18n store, resolved lazily via
 * `app.runWithContext` so it is the same app-scoped instance components receive.
 */
function createTDirective(getStore: () => I18nStore) {
    return defineDirective<TDirectiveValue, HTMLElement>({
        mounted(el, binding) {
            const store = getStore();
            void store.ensureNamespace(nsOf(store, binding.value));
            const state: TState = {
                current: binding.value,
                paint: () => {
                    el.textContent = resolveText(store, state.current);
                },
                stop: () => {}
            };
            // effect → reactive to locale/message changes; runs paint once now.
            state.stop = effect(state.paint).stop;
            (el as unknown as Record<symbol, TState>)[T_STATE] = state;
        },
        updated(el, binding) {
            const state = (el as unknown as Record<symbol, TState>)[T_STATE];
            if (!state) return;
            state.current = binding.value; // value changed → repaint immediately
            state.paint();
        },
        unmounted(el) {
            const state = (el as unknown as Record<symbol, TState>)[T_STATE];
            state?.stop();
            delete (el as unknown as Record<symbol, TState>)[T_STATE];
        }
    });
}

/**
 * Register the `use:t` directive on an app. Install after `createI18n`:
 * `app.use(createI18n(opts)).use(i18nDirectives())`.
 */
export function i18nDirectives(): Plugin {
    return {
        name: 'i18n-directives',
        install(app: App): void {
            let store: I18nStore | undefined;
            const getStore = () => (store ??= app.runWithContext(() => useI18n()));
            app.directive('t', createTDirective(getStore));
        }
    };
}

export { createI18n } from './plugin.js';
