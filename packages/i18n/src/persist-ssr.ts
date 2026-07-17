/**
 * Persistence + SSR state transfer for the i18n store — a thin composition over
 * `@sigx/store`'s `persist` and `ssrState`. We write no persistence or transfer
 * machinery of our own.
 *
 * Order matters (per @sigx/store docs): `ssrState` FIRST (synchronous seed of
 * the server-rendered locale/target + loaded catalogs), then `persist` (whose
 * possibly-async hydration overrides the locale with the device-local choice
 * when present).
 */

import { persist, type PersistHandle, type StorageLike } from '@sigx/store/persist';
import { ssrState } from '@sigx/store/ssr';
import type { Patch, SetupStoreContext } from '@sigx/store';

/** The subset of i18n state this module reads/writes. */
export interface PersistSSRState {
    locale: string;
    // messages is transferred but never persisted to device storage.
    messages: unknown;
}

export interface PersistSSROptions {
    /** Persist the chosen locale (and target) to device storage. Default true. */
    persist?: boolean;
    /** Storage key for the persisted locale. Default `sigx:i18n`. */
    storageKey?: string;
    /** Storage backend. Default `localStorage` (no-op under SSR). */
    storage?: StorageLike;
    /** Transfer server-loaded catalogs + locale to the client. Default true. */
    ssr?: boolean;
}

export interface PersistSSRHandle {
    /** The persist handle (absent when persistence is disabled). */
    persistHandle?: PersistHandle;
    /** True when a server seed was applied on the client. */
    ssrHydrated: boolean;
}

export function installPersistSSR<TState extends PersistSSRState>(
    ctx: SetupStoreContext,
    slice: { state: TState; patch: Patch<TState> },
    options: PersistSSROptions = {}
): PersistSSRHandle {
    const doSSR = options.ssr ?? true;
    const doPersist = options.persist ?? true;

    // `pick` keys are guaranteed present by the `PersistSSRState` constraint, but
    // TS can't prove a string literal ∈ keyof a generic subtype — cast is safe.
    const ssrPick = ['locale', 'messages'] as Extract<keyof TState, string>[];
    const persistPick = ['locale'] as (keyof TState)[];

    // 1) SSR seed first (synchronous): server-rendered locale/target + catalogs.
    const ssrHydrated = doSSR ? ssrState(ctx, slice, { pick: ssrPick }).hydrated : false;

    // 2) Device-local locale/target override (async hydration is safe: persist
    //    pauses saving until hydration completes and applies one atomic patch).
    const persistHandle = doPersist
        ? persist(ctx, slice, {
              key: options.storageKey ?? 'sigx:i18n',
              storage: options.storage,
              pick: persistPick
          })
        : undefined;

    return { persistHandle, ssrHydrated };
}
