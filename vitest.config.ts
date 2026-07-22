import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    // Dev-only warning blocks are guarded by `if (__DEV__)`; tests exercise them.
    define: {
        __DEV__: 'true'
    },
    oxc: {
        jsx: {
            runtime: 'automatic',
            importSource: 'sigx'
        }
    },
    test: {
        environment: 'happy-dom',
        include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**'],
        globals: true
    },
    resolve: {
        alias: {
            '@sigx/i18n/server/node': resolve(__dirname, 'packages/i18n/src/server-node.ts'),
            '@sigx/i18n/server': resolve(__dirname, 'packages/i18n/src/server.ts'),
            '@sigx/i18n/vite': resolve(__dirname, 'packages/i18n/src/vite.ts'),
            '@sigx/i18n': resolve(__dirname, 'packages/i18n/src/index.ts')
        }
    }
});
