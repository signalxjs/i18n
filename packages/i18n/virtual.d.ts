/**
 * Ambient types for the virtual catalog modules emitted by `@sigx/i18n/vite`.
 *
 * Reference it once from the app's `env.d.ts`:
 * ```ts
 * /// <reference types="@sigx/i18n/virtual" />
 * ```
 */

declare module 'virtual:sigx-i18n/catalogs' {
    import type { MessageTree } from '@sigx/i18n';
    /** Every catalog EXCEPT the `serverOnly` namespaces: `catalogs[locale][namespace]`. */
    const catalogs: MessageTree;
    export default catalogs;
}

declare module 'virtual:sigx-i18n/server-catalogs' {
    import type { MessageTree } from '@sigx/i18n';
    /** ONLY the `serverOnly` namespaces — never part of the client graph. */
    const catalogs: MessageTree;
    export default catalogs;
}
