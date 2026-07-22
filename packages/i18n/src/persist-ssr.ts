/**
 * Persistence + SSR state transfer for the i18n store — a thin composition over
 * `@sigx/store`'s `persist` and `ssrState`. We write no persistence or transfer
 * machinery of our own.
 *
 * Order matters (per @sigx/store docs): `ssrState` FIRST (synchronous seed of
 * the server-rendered locale/target + loaded catalogs), then `persist` (whose
 * possibly-async hydration overrides the locale with the device-local choice
 * when present).
 *
 * One thing we DO add on top: `ssrState` is **consume-once** — it deletes its
 * entry from the transfer blob after seeding, so a second store instance in the
 * same document starts from defaults. That is the right default for an ordinary
 * store, and wrong for i18n: with `@sigx/ssr-islands` every island root is its
 * own DI scope (and so its own `'scoped'` store), and under `@sigx/resume` each
 * upgraded boundary can be too. Island #2 onward would hydrate with no locale
 * and no catalogs — wrong language, plus a refetch of catalogs the server
 * already sent. So we remember the seed and re-apply it to later instances.
 */

import { persist, type PersistHandle, type StorageLike } from '@sigx/store/persist';
import { ssrState } from '@sigx/store/ssr';
import { isLiveClient } from '@sigx/runtime-core/internals';
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
    /**
     * Include the loaded catalogs in the transfer. Default true.
     *
     * Set `false` for a **resumable** page: it ships no component JS on load, so
     * the catalogs in the transfer blob are bytes nothing reads — the server
     * already rendered every string into the HTML. The locale still transfers,
     * so a boundary that later upgrades knows which language it is in and
     * fetches only the namespaces it actually needs.
     */
    transferMessages?: boolean;
}

/**
 * The seed `ssrState` consumed, kept for later store instances in the same
 * document (see the module comment). Client-only by construction: `hydrated` is
 * never true on the server, so nothing is ever written here during a render —
 * and the reads are additionally gated on `isLiveClient()`, so a long-lived Node
 * process can never carry one request's locale into another.
 */
let documentSeed: { locale: string; messages: unknown } | null = null;

/** Test seam: drop the remembered document seed. */
export function resetDocumentSeed(): void {
    documentSeed = null;
}

/**
 * Catalogs are plain JSON, so a structural copy is exact — and necessary: handing
 * the same object to two stores would let one store's `addMessages`/lazy load
 * mutate the other's tree (they are independent instances by design).
 */
function cloneMessages(messages: unknown): unknown {
    if (messages === undefined || messages === null) return messages;
    return JSON.parse(JSON.stringify(messages)) as unknown;
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
    const withMessages = options.transferMessages ?? true;

    // `pick` keys are guaranteed present by the `PersistSSRState` constraint, but
    // TS can't prove a string literal ∈ keyof a generic subtype — cast is safe.
    const ssrPick = (withMessages ? ['locale', 'messages'] : ['locale']) as Extract<keyof TState, string>[];
    const persistPick = ['locale'] as (keyof TState)[];

    // 1) SSR seed first (synchronous): server-rendered locale + catalogs.
    let ssrHydrated = doSSR ? ssrState(ctx, slice, { pick: ssrPick }).hydrated : false;

    // 1b) Consume-once repair, for islands and separately-upgraded boundaries.
    if (doSSR) {
        if (ssrHydrated) {
            documentSeed = {
                locale: slice.state.locale,
                messages: withMessages ? cloneMessages(slice.state.messages) : undefined
            };
        } else if (documentSeed && isLiveClient()) {
            // Re-apply what the server sent. `persist` still runs after this, so
            // a device-local choice made since (e.g. the user switched locale in
            // another island) keeps winning — same precedence as instance #1.
            slice.patch(
                (withMessages && documentSeed.messages !== undefined
                    ? { locale: documentSeed.locale, messages: cloneMessages(documentSeed.messages) }
                    : { locale: documentSeed.locale }) as Partial<TState>
            );
            ssrHydrated = true;
        }
    }

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
