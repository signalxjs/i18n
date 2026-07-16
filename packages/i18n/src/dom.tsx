/**
 * @sigx/i18n/dom — the DOM-only `use:t` directive.
 *
 * `use:t` imperatively sets an element's `textContent` (a DOM/`HTMLElement`-only
 * operation with no portable cross-renderer equivalent), so it lives here as a
 * DOM convenience with **no lynx/terminal twin**. The cross-renderer bindings are
 * the accessor (`useTranslation`) and the `<T>` component — both exported from the
 * universal `@sigx/i18n` core (`<T>` is re-exported here for convenience).
 */

import { defineDirective, effect } from 'sigx';
import type { App, Plugin } from '@sigx/runtime-core';
import { useI18n, type I18nStore } from './store.js';
import type { Params } from './types.js';

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

function targetOf(value: TDirectiveValue): string | undefined {
    return typeof value === 'string' ? undefined : value[2]?.target;
}

/**
 * Build the `use:t` directive bound to an app's i18n store, resolved lazily via
 * `app.runWithContext` so it is the same app-scoped instance components receive.
 */
function createTDirective(getStore: () => I18nStore) {
    return defineDirective<TDirectiveValue, HTMLElement>({
        mounted(el, binding) {
            const store = getStore();
            void store.ensureNamespace(nsOf(store, binding.value), targetOf(binding.value));
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

// Convenience re-exports so DOM apps can import everything from one place.
export { T, renderRich } from './component.js';
export type { TProps, RichComponents } from './component.js';
export { createI18n } from './plugin.js';
