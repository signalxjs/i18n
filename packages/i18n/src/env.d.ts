/**
 * Compile-time dev flag. `defineLibConfig` pins it (false in prod builds, a
 * NODE_ENV check in dev builds); `vitest.config.ts` defines it `true` for tests.
 * Guard all dev-only warnings/validation with `if (__DEV__)`.
 */
declare const __DEV__: boolean;
